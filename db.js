// src/db.js — SQLite con better-sqlite3
// Railway persiste el filesystem en /data si usás un volumen, 
// o podés usar la DB en memoria para testing

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'db', 'whoop.db');

export const db = new Database(DB_PATH);

// Pragma de performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ───────────────────────────────────────────────────────────────────

db.exec(`
  -- Códigos de pairing y tokens OAuth por usuario
  CREATE TABLE IF NOT EXISTS pairing_codes (
    code             TEXT PRIMARY KEY,   -- "WG-4X9K"
    expires_at       INTEGER NOT NULL,   -- timestamp ms (expiración del código, no del token)
    paired           INTEGER DEFAULT 0,  -- 0 = esperando, 1 = conectado
    access_token     TEXT,
    refresh_token    TEXT,
    token_expires_at INTEGER,
    created_at       INTEGER DEFAULT (unixepoch() * 1000)
  );

  -- Último dato cacheado por usuario (sobrescribimos cada sync)
  CREATE TABLE IF NOT EXISTS whoop_data (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    code             TEXT NOT NULL,
    recovery         INTEGER,    -- 0-100
    hrv              REAL,       -- ms
    rhr              INTEGER,    -- bpm
    strain           REAL,       -- 0.0-21.0
    sleep_hours      REAL,
    sleep_efficiency INTEGER,    -- %
    updated_at       INTEGER     -- timestamp ms
  );

  CREATE INDEX IF NOT EXISTS idx_whoop_data_code ON whoop_data(code);
`);

console.log('[db] SQLite ready at', DB_PATH);
