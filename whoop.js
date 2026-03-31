// src/whoop.js — Cliente de la API de Whoop

import axios from 'axios';

const WHOOP_API = 'https://api.prod.whoop.com/developer/v1';

// ─── Generador de códigos de pairing ─────────────────────────────────────────
// Formato: "WG-XXXX" — fácil de tipear en el reloj

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin O,0,I,1 para evitar confusión

export function generateCode() {
  let code = 'WG-';
  for (let i = 0; i < 4; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

// ─── Fetch de todos los datos necesarios ─────────────────────────────────────

export async function fetchWhoopData(accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}` };

  try {
    // Las tres llamadas en paralelo
    const [recoveryRes, sleepRes, cycleRes] = await Promise.all([
      axios.get(`${WHOOP_API}/recovery`, { headers }),
      axios.get(`${WHOOP_API}/activity/sleep`, { headers }),
      axios.get(`${WHOOP_API}/cycle`, { headers }),
    ]);

    // Recovery: tomamos el más reciente
    const recovery = recoveryRes.data.records?.[0];
    const sleep    = sleepRes.data.records?.[0];
    const cycle    = cycleRes.data.records?.[0];

    if (!recovery) {
      console.warn('[whoop] No hay datos de recovery todavía');
      return null;
    }

    // Calcular horas de sueño desde milisegundos
    const sleepMs = sleep?.score?.stage_summary?.total_in_bed_time_milli ?? 0;
    const sleepHours = sleepMs / (1000 * 60 * 60);

    return {
      recovery:   Math.round(recovery.score?.recovery_score ?? 0),
      hrv:        Math.round(recovery.score?.hrv_rmssd_milli ?? 0),
      rhr:        Math.round(recovery.score?.resting_heart_rate ?? 0),
      strain:     parseFloat((cycle?.score?.strain ?? 0).toFixed(1)),
      sleepHours: parseFloat(sleepHours.toFixed(1)),
      sleepEff:   Math.round(sleep?.score?.sleep_efficiency_percentage ?? 0),
    };

  } catch (err) {
    // 401 = token expirado (el caller se encarga de refrescarlo)
    if (err.response?.status === 401) {
      throw err; // re-throw para que syncUser lo detecte
    }
    console.error('[whoop] fetchWhoopData error:', err.response?.data || err.message);
    return null;
  }
}
