import type { DB } from '../storage/db.js';
import { childLogger, errMsg } from '../util/logger.js';

const log = childLogger('health');

export interface SourceHealthRow {
  name: string;
  last_run: number | null;
  last_ok: number | null;
  last_error: string | null;
  last_error_at: number | null;
  last_count: number | null;
  consecutive_fails: number;
}

/**
 * Runs one source in isolation: any throw/timeout is caught, logged and
 * recorded, and an empty list is returned, so one broken feed never stops
 * the others.
 */
export async function runIsolated<T>(
  db: DB,
  name: string,
  fn: () => Promise<T[]>,
  timeoutMs = 30_000,
): Promise<T[]> {
  const started = Date.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${timeoutMs / 1000}s`)), timeoutMs)),
    ]);
    db.prepare(
      `INSERT INTO source_health(name, last_run, last_ok, last_count, consecutive_fails)
       VALUES(?, ?, ?, ?, 0)
       ON CONFLICT(name) DO UPDATE SET last_run = excluded.last_run, last_ok = excluded.last_ok,
         last_count = excluded.last_count, consecutive_fails = 0`,
    ).run(name, started, Date.now(), result.length);
    return result;
  } catch (err) {
    const message = errMsg(err).slice(0, 300);
    const row = db
      .prepare(
        `INSERT INTO source_health(name, last_run, last_error, last_error_at, consecutive_fails)
         VALUES(?, ?, ?, ?, 1)
         ON CONFLICT(name) DO UPDATE SET last_run = excluded.last_run, last_error = excluded.last_error,
           last_error_at = excluded.last_error_at, consecutive_fails = consecutive_fails + 1
         RETURNING consecutive_fails`,
      )
      .get(name, started, message, Date.now()) as { consecutive_fails: number };
    // Log loudly on the first failure and then every 30th, to avoid log spam when a feed is down for hours.
    if (row.consecutive_fails === 1 || row.consecutive_fails % 30 === 0) {
      log.warn({ source: name, fails: row.consecutive_fails, err: message }, 'source failed (others keep running)');
    }
    return [];
  }
}

export function allHealth(db: DB): SourceHealthRow[] {
  return db.prepare('SELECT * FROM source_health ORDER BY name').all() as SourceHealthRow[];
}
