import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS seen_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  url_hash      TEXT NOT NULL,
  title_hash    TEXT NOT NULL,
  title         TEXT NOT NULL,
  norm_title    TEXT NOT NULL,
  url           TEXT,
  source        TEXT NOT NULL,
  kind          TEXT NOT NULL,          -- news | social
  summary       TEXT,
  published_at  INTEGER NOT NULL,       -- ms epoch
  first_seen    INTEGER NOT NULL,       -- ms epoch
  status        TEXT NOT NULL,          -- pending | analyzed | skipped | failed | duplicate
  attempts      INTEGER NOT NULL DEFAULT 0,
  duplicate_of  INTEGER,
  also_sources  TEXT                    -- comma list of other sources that ran the same story
);
CREATE INDEX IF NOT EXISTS idx_seen_url ON seen_items(url_hash);
CREATE INDEX IF NOT EXISTS idx_seen_title ON seen_items(title_hash);
CREATE INDEX IF NOT EXISTS idx_seen_first ON seen_items(first_seen);
CREATE INDEX IF NOT EXISTS idx_seen_status ON seen_items(status);

CREATE TABLE IF NOT EXISTS analyses (
  item_id       INTEGER PRIMARY KEY REFERENCES seen_items(id),
  relevant      INTEGER NOT NULL,
  impact        TEXT NOT NULL,
  gold_bias     TEXT NOT NULL,
  confidence    INTEGER NOT NULL,
  headline      TEXT NOT NULL,
  explanation   TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  routed        TEXT NOT NULL           -- instant | digest | dropped
);

CREATE TABLE IF NOT EXISTS outbox (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL,          -- alert | digest | reminder | result | briefing | weekly | session | command | system
  priority      INTEGER NOT NULL,       -- lower = sooner
  text          TEXT NOT NULL,
  status        TEXT NOT NULL,          -- queued | sent | failed
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER,                -- drop instead of sending late (e.g. a reminder after the event)
  sent_at       INTEGER,
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, priority, id);

CREATE TABLE IF NOT EXISTS digest_queue (
  item_id       INTEGER PRIMARY KEY REFERENCES seen_items(id),
  reason        TEXT NOT NULL,          -- medium | muted-high
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  country       TEXT NOT NULL,
  impact        TEXT NOT NULL,          -- High | Medium | Low | Holiday (as published)
  key_level     TEXT NOT NULL,          -- high | medium (our effective level)
  at_ms         INTEGER NOT NULL,
  forecast      TEXT,
  previous      TEXT,
  actual        TEXT,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cal_at ON calendar_events(at_ms);

CREATE TABLE IF NOT EXISTS flags (
  key           TEXT PRIMARY KEY,       -- one-shot markers, e.g. remind30:<eventId>
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_health (
  name               TEXT PRIMARY KEY,
  last_run           INTEGER,
  last_ok            INTEGER,
  last_error         TEXT,
  last_error_at      INTEGER,
  last_count         INTEGER,
  consecutive_fails  INTEGER NOT NULL DEFAULT 0
);
`;

export function openDb(dataDir: string, filename = 'gold-alerts.sqlite'): DB {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(filename === ':memory:' ? ':memory:' : path.join(dataDir, filename));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

// ---------- small helpers used across modules ----------

export function getSetting(db: DB, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(db: DB, key: string, value: string | undefined): void {
  if (value === undefined) db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  else
    db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      key,
      value,
    );
}

/** Sets a one-shot flag. Returns true only the first time (so callers can "do once"). */
export function claimFlag(db: DB, key: string): boolean {
  const res = db.prepare('INSERT OR IGNORE INTO flags(key, created_at) VALUES(?, ?)').run(key, Date.now());
  return res.changes === 1;
}

export function hasFlag(db: DB, key: string): boolean {
  return !!db.prepare('SELECT 1 FROM flags WHERE key = ?').get(key);
}

/** Housekeeping: drop old rows so the DB stays small on a tiny VPS. */
export function pruneOld(db: DB, days = 14): void {
  const cutoff = Date.now() - days * 86_400_000;
  db.transaction(() => {
    db.prepare('DELETE FROM digest_queue WHERE item_id IN (SELECT id FROM seen_items WHERE first_seen < ?)').run(cutoff);
    db.prepare('DELETE FROM analyses WHERE item_id IN (SELECT id FROM seen_items WHERE first_seen < ?)').run(cutoff);
    db.prepare('UPDATE seen_items SET duplicate_of = NULL WHERE duplicate_of IN (SELECT id FROM seen_items WHERE first_seen < ?)').run(cutoff);
    db.prepare('DELETE FROM seen_items WHERE first_seen < ?').run(cutoff);
    db.prepare("DELETE FROM outbox WHERE status != 'queued' AND created_at < ?").run(cutoff);
    db.prepare('DELETE FROM flags WHERE created_at < ?').run(Date.now() - 60 * 86_400_000);
    db.prepare('DELETE FROM calendar_events WHERE at_ms < ?').run(Date.now() - 30 * 86_400_000);
  })();
}
