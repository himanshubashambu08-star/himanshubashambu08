import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { childLogger, errMsg } from '../util/logger.js';

const log = childLogger('config');

const FeedSchema = z.object({
  id: z.string(),
  source: z.string(),
  url: z.string().url(),
  enabled: z.boolean().default(true),
  filter: z.array(z.string()).optional(),
});
const FeedsFileSchema = z.object({ feeds: z.array(FeedSchema) });
export type FeedConfig = z.infer<typeof FeedSchema>;

const AccountSchema = z.object({
  handle: z.string(),
  name: z.string(),
  enabled: z.boolean().default(true),
  rssUrl: z.string().url().optional(),
});
const SocialFileSchema = z.object({
  truthSocial: z.array(AccountSchema).default([]),
  x: z.array(AccountSchema).default([]),
});
export type SocialAccount = z.infer<typeof AccountSchema>;
export type SocialConfig = z.infer<typeof SocialFileSchema>;

const HHMM = z.string().regex(/^\d{1,2}:\d{2}$/);
const HolidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string(),
  type: z.enum(['closed', 'early_close']),
  close: HHMM.optional(),
  reopen: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  verify: z.boolean().optional(),
});
const HolidaysFileSchema = z.object({
  timezone: z.string().default('America/New_York'),
  regular: z.object({
    dailyClose: HHMM,
    dailyReopen: HHMM,
    sundayOpen: HHMM,
    fridayClose: HHMM,
  }),
  days: z.array(HolidaySchema),
});
export type HolidayDay = z.infer<typeof HolidaySchema>;
export type HolidaysConfig = z.infer<typeof HolidaysFileSchema>;

/**
 * Reads a JSON config file and re-reads it whenever it changes on disk,
 * so you can edit feeds/accounts/holidays without restarting the bot.
 * If an edit breaks the file, the last good version keeps being used.
 */
class ConfigFile<T> {
  private value: T | undefined;
  private mtime = 0;
  constructor(
    private readonly file: string,
    private readonly schema: z.ZodType<T>,
  ) {}

  get(): T {
    try {
      const st = fs.statSync(this.file);
      if (!this.value || st.mtimeMs !== this.mtime) {
        const parsed = this.schema.parse(JSON.parse(fs.readFileSync(this.file, 'utf8')));
        if (this.value) log.info({ file: path.basename(this.file) }, 'config file reloaded');
        this.value = parsed;
        this.mtime = st.mtimeMs;
      }
    } catch (err) {
      if (!this.value) throw new Error(`Cannot load ${this.file}: ${errMsg(err)}`);
      log.error({ file: this.file, err: errMsg(err) }, 'config file invalid, keeping previous version');
      this.mtime = 0;
    }
    return this.value;
  }
}

export interface ConfigFiles {
  feeds: () => FeedConfig[];
  social: () => SocialConfig;
  holidays: () => HolidaysConfig;
}

export function loadConfigFiles(configDir: string): ConfigFiles {
  const feeds = new ConfigFile(path.join(configDir, 'feeds.json'), FeedsFileSchema);
  const social = new ConfigFile(path.join(configDir, 'social-accounts.json'), SocialFileSchema);
  const holidays = new ConfigFile(path.join(configDir, 'cme-holidays.json'), HolidaysFileSchema);
  // Validate everything once at startup so mistakes show up immediately.
  feeds.get();
  social.get();
  holidays.get();
  return {
    feeds: () => feeds.get().feeds,
    social: () => social.get(),
    holidays: () => holidays.get(),
  };
}
