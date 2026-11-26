import type { DB } from '../storage/db.js';
import { childLogger, errMsg } from '../util/logger.js';

const log = childLogger('outbox');

export type MessageKind =
  | 'alert'
  | 'digest'
  | 'reminder'
  | 'result'
  | 'session'
  | 'briefing'
  | 'weekly'
  | 'command'
  | 'system';

/** Lower number = sent first. Command replies jump the queue; digests and briefings wait behind alerts. */
const PRIORITY: Record<MessageKind, number> = {
  command: 0,
  reminder: 1,
  alert: 2,
  result: 2,
  session: 3,
  system: 4,
  briefing: 5,
  weekly: 5,
  digest: 6,
};

export interface Sender {
  isReady(): boolean;
  send(text: string): Promise<void>;
}

interface OutRow {
  id: number;
  kind: MessageKind;
  text: string;
  attempts: number;
  expires_at: number | null;
}

/**
 * Durable, rate-limited message queue. Everything the bot says goes through here:
 * - at most one WhatsApp message every `intervalMs` (default 5s),
 * - survives restarts (rows live in SQLite),
 * - waits while WhatsApp is disconnected,
 * - while muted, only command replies are sent; the rest waits until unmute.
 */
export class Outbox {
  private timer: NodeJS.Timeout | undefined;
  private busy = false;
  private lastSentAt = 0;

  constructor(
    private readonly db: DB,
    private readonly sender: Sender,
    private readonly intervalMs: number,
    private readonly isMuted: () => boolean,
  ) {}

  enqueue(kind: MessageKind, text: string, opts: { expiresAt?: number } = {}): number {
    const res = this.db
      .prepare('INSERT INTO outbox(kind, priority, text, status, created_at, expires_at) VALUES(?, ?, ?, ?, ?, ?)')
      .run(kind, PRIORITY[kind], text, 'queued', Date.now(), opts.expiresAt ?? null);
    return Number(res.lastInsertRowid);
  }

  pending(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status = 'queued'").get() as { n: number }).n;
  }

  lastSent(): number | null {
    const r = this.db.prepare("SELECT MAX(sent_at) AS t FROM outbox WHERE status = 'sent'").get() as { t: number | null };
    return r.t;
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), 500);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Exposed for tests. */
  async tick(now = Date.now()): Promise<void> {
    if (this.busy || now - this.lastSentAt < this.intervalMs || !this.sender.isReady()) return;
    this.busy = true;
    try {
      this.db.prepare("UPDATE outbox SET status = 'expired' WHERE status = 'queued' AND expires_at IS NOT NULL AND expires_at < ?").run(now);
      const muted = this.isMuted();
      const row = this.db
        .prepare(
          `SELECT id, kind, text, attempts, expires_at FROM outbox WHERE status = 'queued' ${muted ? "AND kind = 'command'" : ''}
           ORDER BY priority, id LIMIT 1`,
        )
        .get() as OutRow | undefined;
      if (!row) return;
      try {
        await this.sender.send(row.text);
        this.lastSentAt = now;
        this.db.prepare("UPDATE outbox SET status = 'sent', sent_at = ? WHERE id = ?").run(Date.now(), row.id);
      } catch (err) {
        const attempts = row.attempts + 1;
        // Back off a little so a flaky connection doesn't hammer WhatsApp.
        this.lastSentAt = now + Math.min(60_000, 5_000 * attempts);
        this.db
          .prepare('UPDATE outbox SET attempts = ?, last_error = ?, status = ? WHERE id = ?')
          .run(attempts, errMsg(err).slice(0, 300), attempts >= 5 ? 'failed' : 'queued', row.id);
        log.warn({ id: row.id, kind: row.kind, attempts, err: errMsg(err) }, 'send failed');
      }
    } finally {
      this.busy = false;
    }
  }
}

/** Prints messages instead of sending them (DRY_RUN=true). Handy for testing everything except WhatsApp. */
export class ConsoleSender implements Sender {
  isReady() {
    return true;
  }
  async send(text: string) {
    process.stdout.write(`\n────────── WhatsApp (dry run) ──────────\n${text}\n────────────────────────────────────────\n`);
  }
}
