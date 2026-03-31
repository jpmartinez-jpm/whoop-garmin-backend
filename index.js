// src/index.js — WHOOP × Garmin Backend
// Railway-ready: lee todo de variables de entorno

import express   from 'express';
import cors      from 'cors';
import axios     from 'axios';
import cron      from 'node-cron';
import { db }    from './db.js';
import { generateCode, fetchWhoopData } from './whoop.js';

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Rutas públicas (sin auth) ──────────────────────────────────────────────

// Health check (Railway lo necesita)
app.get('/health', (req, res) => res.json({ ok: true }));

// ─── Flujo de pairing ────────────────────────────────────────────────────────
//
// 1. Widget llama a POST /pair/init  → recibe código de 6 chars
// 2. Usuario va a /connect?code=XXX  → hace OAuth con Whoop
// 3. Whoop redirige a /oauth/callback con authorization_code
// 4. Backend intercambia code por tokens y los guarda bajo el código de pairing
// 5. Widget llama a GET /pair/status/:code → recibe paired: true cuando listo

// 1. Widget pide un código de pairing
app.post('/pair/init', (req, res) => {
  const code = generateCode();           // "WG-4X9K"
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 min para completar el pairing

  db.prepare(`
    INSERT INTO pairing_codes (code, expires_at, paired)
    VALUES (?, ?, 0)
  `).run(code, expiresAt);

  return res.json({ code, expiresAt });
});

// 2. Widget consulta si el pairing se completó
app.get('/pair/status/:code', (req, res) => {
  const row = db.prepare(`SELECT paired FROM pairing_codes WHERE code = ?`)
    .get(req.params.code);

  if (!row) return res.status(404).json({ error: 'Código no encontrado' });
  return res.json({ paired: row.paired === 1 });
});

// 3. Página de inicio del OAuth (usuario la abre en el teléfono)
app.get('/connect', (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Falta el código del reloj');

  const row = db.prepare(`SELECT * FROM pairing_codes WHERE code = ?`).get(code);
  if (!row) return res.status(404).send('Código inválido o expirado');
  if (row.paired) return res.send('Ya conectado ✓');

  // Redirigir a Whoop OAuth
  const params = new URLSearchParams({
    client_id:     process.env.WHOOP_CLIENT_ID,
    redirect_uri:  process.env.WHOOP_REDIRECT_URI,
    response_type: 'code',
    scope:         'read:recovery read:sleep read:workout read:cycles read:profile',
    state:         code,   // guardamos el código de pairing en state
  });

  return res.redirect(`https://api.prod.whoop.com/oauth/oauth2/auth?${params}`);
});

// 4. Whoop redirige acá después del login
app.get('/oauth/callback', async (req, res) => {
  const { code: authCode, state: pairingCode } = req.query;

  if (!authCode || !pairingCode) {
    return res.status(400).send('Parámetros inválidos');
  }

  try {
    // Intercambiar authorization_code por tokens
    const tokenRes = await axios.post(
      'https://api.prod.whoop.com/oauth/oauth2/token',
      new URLSearchParams({
        grant_type:    'authorization_code',
        code:          authCode,
        redirect_uri:  process.env.WHOOP_REDIRECT_URI,
        client_id:     process.env.WHOOP_CLIENT_ID,
        client_secret: process.env.WHOOP_CLIENT_SECRET,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = tokenRes.data;
    const tokenExpiresAt = Date.now() + expires_in * 1000;

    // Guardar tokens vinculados al código de pairing
    db.prepare(`
      UPDATE pairing_codes
      SET paired = 1, access_token = ?, refresh_token = ?, token_expires_at = ?
      WHERE code = ?
    `).run(access_token, refresh_token, tokenExpiresAt, pairingCode);

    // Fetch inicial de datos
    await syncUser(pairingCode);

    return res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0f;color:#e0e0f0">
        <h2 style="color:#00e676">✓ Conectado</h2>
        <p>Tu reloj Garmin ahora muestra tus datos de WHOOP.</p>
        <p style="color:#555577;font-size:14px">Podés cerrar esta pantalla.</p>
      </body></html>
    `);
  } catch (err) {
    console.error('OAuth callback error:', err.response?.data || err.message);
    return res.status(500).send('Error al conectar con WHOOP. Intentá de nuevo.');
  }
});

// ─── Ruta que consume el widget del reloj ────────────────────────────────────
//
// El widget llama a GET /data/:code cada vez que quiere actualizar.
// Devuelve el último dato cacheado (no llama a Whoop en tiempo real).

app.get('/data/:code', (req, res) => {
  const row = db.prepare(`
    SELECT w.* FROM whoop_data w
    JOIN pairing_codes p ON p.code = ?
    WHERE w.code = ?
    ORDER BY w.updated_at DESC
    LIMIT 1
  `).get(req.params.code, req.params.code);

  if (!row) {
    return res.status(404).json({ error: 'Sin datos todavía' });
  }

  return res.json({
    recovery:   row.recovery,
    hrv:        row.hrv,
    rhr:        row.rhr,
    strain:     row.strain,
    sleepHours: row.sleep_hours,
    sleepEff:   row.sleep_efficiency,
    updatedAt:  row.updated_at,
  });
});

// ─── Sync de datos de Whoop ──────────────────────────────────────────────────

async function syncUser(code) {
  const user = db.prepare(`SELECT * FROM pairing_codes WHERE code = ?`).get(code);
  if (!user || !user.access_token) return;

  // Refresh token si está por vencer (menos de 5 min)
  let token = user.access_token;
  if (user.token_expires_at - Date.now() < 5 * 60 * 1000) {
    token = await refreshToken(user);
    if (!token) return;
  }

  const data = await fetchWhoopData(token);
  if (!data) return;

  db.prepare(`
    INSERT INTO whoop_data (code, recovery, hrv, rhr, strain, sleep_hours, sleep_efficiency, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    code,
    data.recovery,
    data.hrv,
    data.rhr,
    data.strain,
    data.sleepHours,
    data.sleepEff,
    Date.now()
  );
}

async function refreshToken(user) {
  try {
    const res = await axios.post(
      'https://api.prod.whoop.com/oauth/oauth2/token',
      new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: user.refresh_token,
        client_id:     process.env.WHOOP_CLIENT_ID,
        client_secret: process.env.WHOOP_CLIENT_SECRET,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = res.data;
    db.prepare(`
      UPDATE pairing_codes
      SET access_token = ?, refresh_token = ?, token_expires_at = ?
      WHERE code = ?
    `).run(access_token, refresh_token, Date.now() + expires_in * 1000, user.code);

    return access_token;
  } catch (err) {
    console.error('Token refresh failed for', user.code, err.message);
    return null;
  }
}

// ─── Cron: actualiza datos cada 30 min ──────────────────────────────────────

cron.schedule('*/30 * * * *', async () => {
  console.log('[cron] Syncing all users...');
  const users = db.prepare(`SELECT code FROM pairing_codes WHERE paired = 1`).all();
  for (const u of users) {
    await syncUser(u.code);
  }
  console.log(`[cron] Done — ${users.length} users updated`);
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`WHOOP × Garmin backend running on :${PORT}`);
});
