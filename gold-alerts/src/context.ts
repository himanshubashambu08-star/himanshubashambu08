import type { Analyzer } from './analysis/claude.js';
import type { ConfigFiles } from './config/files.js';
import type { Env } from './config/env.js';
import type { Outbox } from './delivery/outbox.js';
import { getSetting, setSetting, type DB } from './storage/db.js';

export interface RuntimeState {
  startedAt: number;
  lastNewsPoll: number | null;
  lastNewsPollItems: number;
  lastCalendarSync: number | null;
  lastCalendarError: string | null;
  lastAnalysisOk: number | null;
  lastAnalysisError: string | null;
  whatsapp: () => { connected: boolean; since: number | null; lastDisconnect: string | null };
}

export interface AppContext {
  env: Env;
  cfg: ConfigFiles;
  db: DB;
  analyzer: Analyzer;
  outbox: Outbox;
  state: RuntimeState;
}

const MUTE_KEY = 'mute_until';

export function muteUntil(db: DB): number | null {
  const v = getSetting(db, MUTE_KEY);
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function isMuted(db: DB, now = Date.now()): boolean {
  const u = muteUntil(db);
  return u !== null && u > now;
}

export function setMute(db: DB, until: number | null): void {
  setSetting(db, MUTE_KEY, until === null ? undefined : String(until));
}
