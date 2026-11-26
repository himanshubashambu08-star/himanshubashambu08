import path from 'node:path';
import type { Analyzer, ItemAnalysis, ReleaseResult } from '../src/analysis/claude.js';
import { loadEnv } from '../src/config/env.js';
import { loadConfigFiles } from '../src/config/files.js';
import type { AppContext } from '../src/context.js';
import { isMuted } from '../src/context.js';
import { Outbox, type Sender } from '../src/delivery/outbox.js';
import { openDb } from '../src/storage/db.js';
import { setUserTimezone } from '../src/util/time.js';

export class MemorySender implements Sender {
  sent: string[] = [];
  ready = true;
  isReady() {
    return this.ready;
  }
  async send(text: string) {
    this.sent.push(text);
  }
}

/** Stand-in for Claude in unit tests: returns whatever the test sets up, keyed by a word in the title. */
export class FakeAnalyzer {
  rules: { match: RegExp; result: Omit<ItemAnalysis, 'index'> }[] = [];
  release: ReleaseResult | null = null;
  calls = 0;
  async analyzeBatch(items: { index: number; title: string }[]) {
    this.calls++;
    const out = new Map<number, ItemAnalysis>();
    for (const it of items) {
      const rule = this.rules.find((r) => r.match.test(it.title));
      out.set(it.index, {
        index: it.index,
        ...(rule?.result ?? {
          relevant: false,
          impact: 'low',
          gold_bias: 'neutral',
          confidence: 50,
          headline_hinglish: 'kuch nahi',
          explanation: 'irrelevant',
        }),
      });
    }
    return out;
  }
  async extractRelease() {
    return this.release;
  }
  async ping() {
    return true;
  }
}

export function makeCtx(overrides: Record<string, string> = {}) {
  const env = loadEnv({
    MY_WHATSAPP_NUMBER: '15195550000',
    CONFIG_DIR: path.resolve(import.meta.dirname, '../config'),
    DATA_DIR: '/tmp',
    TIMEZONE: 'America/Toronto',
    ...overrides,
  });
  setUserTimezone(env.TIMEZONE);
  const db = openDb('/tmp', ':memory:');
  const sender = new MemorySender();
  const analyzer = new FakeAnalyzer();
  const outbox = new Outbox(db, sender, 0, () => isMuted(db));
  const ctx: AppContext = {
    env,
    cfg: loadConfigFiles(env.configDir),
    db,
    analyzer: analyzer as unknown as Analyzer,
    outbox,
    state: {
      startedAt: Date.now(),
      lastNewsPoll: null,
      lastNewsPollItems: 0,
      lastCalendarSync: null,
      lastCalendarError: null,
      lastAnalysisOk: null,
      lastAnalysisError: null,
      whatsapp: () => ({ connected: true, since: null, lastDisconnect: null }),
    },
  };
  /** Delivers everything queued (ignores the 5s spacing). */
  const flush = async () => {
    for (let i = 0; i < 50 && outbox.pending() > 0; i++) await outbox.tick(Date.now() + i * 10_000_000);
    return sender.sent;
  };
  return { ctx, db, sender, analyzer, outbox, flush };
}
