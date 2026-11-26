import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => ['1', 'true', 'yes', 'on'].includes((v ?? '').trim().toLowerCase()));

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? def : Number.parseInt(v, 10)))
    .pipe(z.number().int());

const hhmm = (def: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : def))
    .pipe(z.string().regex(/^\d{1,2}:\d{2}$/, 'use HH:MM (24h)'));

const EnvSchema = z.object({
  MY_WHATSAPP_NUMBER: z
    .string({ error: 'MY_WHATSAPP_NUMBER is required (international format, digits only, e.g. 15195551234)' })
    .transform((v) => v.replace(/\D/g, ''))
    .pipe(z.string().min(8, 'MY_WHATSAPP_NUMBER looks too short')),
  BOT_PAIRING_NUMBER: z
    .string()
    .optional()
    .transform((v) => (v ? v.replace(/\D/g, '') : undefined)),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional().default('claude-haiku-5-5'),

  FINNHUB_API_KEY: z.string().optional(),

  ENABLE_X: bool,
  X_RSS_URL_TEMPLATE: z.string().optional(),

  TIMEZONE: z.string().optional().default('America/Toronto'),
  DATA_DIR: z.string().optional().default('./data'),
  CONFIG_DIR: z.string().optional().default('./config'),

  NEWS_POLL_SECONDS: int(60),
  CALENDAR_SYNC_MINUTES: int(15),
  DIGEST_INTERVAL_MINUTES: int(30),
  MAX_ITEM_AGE_MINUTES: int(90),
  SEND_INTERVAL_MS: int(5000),
  DUPLICATE_SIMILARITY: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 0.5))
    .pipe(z.number().min(0.1).max(1)),

  QUIET_HOURS_START: hhmm('22:00'),
  QUIET_HOURS_END: hhmm('07:00'),
  BRIEFING_TIME: hhmm('07:00'),
  WEEKLY_OUTLOOK_TIME: hhmm('18:00'),

  DRY_RUN: bool,
  LOG_LEVEL: z.string().optional().default('info'),
});

export type Env = z.infer<typeof EnvSchema> & { dataDir: string; configDir: string; myJid: string };

let cached: Env | undefined;

export function loadEnv(overrides: Record<string, string | undefined> = {}): Env {
  if (cached && Object.keys(overrides).length === 0) return cached;
  const parsed = EnvSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid .env configuration:\n${msg}`);
  }
  const env = parsed.data;
  const result: Env = {
    ...env,
    dataDir: path.resolve(env.DATA_DIR),
    configDir: path.resolve(env.CONFIG_DIR),
    myJid: `${env.MY_WHATSAPP_NUMBER}@s.whatsapp.net`,
  };
  if (Object.keys(overrides).length === 0) cached = result;
  return result;
}
