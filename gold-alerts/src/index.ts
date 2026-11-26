import { Analyzer } from './analysis/claude.js';
import { loadEnv } from './config/env.js';
import { loadConfigFiles } from './config/files.js';
import type { AppContext, RuntimeState } from './context.js';
import { isMuted } from './context.js';
import { handleCommand } from './delivery/commands.js';
import { ConsoleSender, Outbox, type Sender } from './delivery/outbox.js';
import { WhatsAppClient } from './delivery/whatsapp.js';
import { startScheduler } from './scheduler/index.js';
import { openDb } from './storage/db.js';
import { childLogger, errMsg } from './util/logger.js';
import { setUserTimezone } from './util/time.js';

const log = childLogger('main');

async function main() {
  const env = loadEnv();
  setUserTimezone(env.TIMEZONE);
  const cfg = loadConfigFiles(env.configDir);
  const db = openDb(env.dataDir);
  const pairOnly = process.argv.includes('--pair-only');

  if (!env.ANTHROPIC_API_KEY) log.warn('ANTHROPIC_API_KEY is not set — headlines cannot be analyzed, so no news alerts will go out.');

  let wa: WhatsAppClient | undefined;
  let sender: Sender;
  let ctx: AppContext | undefined;
  let announced = false;

  const onCommand = (text: string) => {
    if (!ctx) return;
    log.info({ cmd: text.slice(0, 40) }, 'command from owner');
    try {
      ctx.outbox.enqueue('command', handleCommand(ctx, text));
    } catch (err) {
      log.error({ err: errMsg(err) }, 'command failed');
      ctx.outbox.enqueue('command', `⚠️ Command fail ho gaya: ${errMsg(err).slice(0, 100)}`);
    }
  };

  if (env.DRY_RUN) {
    log.warn('DRY_RUN=true — messages are printed here instead of sent to WhatsApp');
    sender = new ConsoleSender();
  } else {
    wa = new WhatsAppClient({
      dataDir: env.dataDir,
      ownerNumber: env.MY_WHATSAPP_NUMBER,
      pairingNumber: env.BOT_PAIRING_NUMBER,
      onCommand,
      onOpen: () => {
        if (pairOnly) {
          log.info('✅ Linked! Session saved in data/whatsapp-auth. Now start the bot normally (npm start / pm2).');
          setTimeout(() => process.exit(0), 3_000);
          return;
        }
        if (!announced && ctx) {
          announced = true;
          ctx.outbox.enqueue('system', '✅ Gold Alert Bot online hai. "help" bhejo commands ke liye, "test" status ke liye.');
        }
      },
    });
    sender = wa;
  }

  if (pairOnly) {
    if (!wa) throw new Error('--pair-only needs DRY_RUN=false');
    await wa.start();
    return;
  }

  const state: RuntimeState = {
    startedAt: Date.now(),
    lastNewsPoll: null,
    lastNewsPollItems: 0,
    lastCalendarSync: null,
    lastCalendarError: null,
    lastAnalysisOk: null,
    lastAnalysisError: null,
    whatsapp: () => ({ connected: sender.isReady(), since: wa?.connectedSince ?? null, lastDisconnect: wa?.lastDisconnectReason ?? null }),
  };
  const outbox = new Outbox(db, sender, env.SEND_INTERVAL_MS, () => isMuted(db));
  ctx = { env, cfg, db, analyzer: new Analyzer(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL), outbox, state };

  outbox.start();
  await wa?.start();
  const stopScheduler = startScheduler(ctx);

  if (env.DRY_RUN) {
    // In dry-run mode you can type commands (test, today, mute 1h, ...) into the terminal.
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => chunk.split('\n').filter((l) => l.trim()).forEach(onCommand));
    log.info('Type a command (test, today, week, digest, mute 1h, unmute, help) and press Enter.');
  }

  const shutdown = async (sig: string) => {
    log.info({ sig }, 'shutting down');
    stopScheduler();
    outbox.stop();
    await wa?.stop();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

process.on('unhandledRejection', (err) => log.error({ err: errMsg(err) }, 'unhandled rejection (kept running)'));
process.on('uncaughtException', (err) => log.error({ err: errMsg(err), stack: err.stack }, 'uncaught exception (kept running)'));

main().catch((err) => {
  log.fatal({ err: errMsg(err) }, 'failed to start');
  process.exit(1);
});
