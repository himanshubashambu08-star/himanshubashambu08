import cron, { type ScheduledTask } from 'node-cron';
import type { AppContext } from '../context.js';
import { isMuted } from '../context.js';
import { analyzePending, pollNews, sendDigest } from '../analysis/pipeline.js';
import { checkMuteExpiry } from '../delivery/commands.js';
import { pruneOld } from '../storage/db.js';
import { childLogger, errMsg } from '../util/logger.js';
import { inQuietHours, nowLocal, parseHHMM } from '../util/time.js';
import { checkEarlyClose, sendMorningBriefing, sendWeeklyOutlook } from './briefings.js';
import { checkReleaseResults, checkReminders, syncCalendar } from './calendar-jobs.js';

const log = childLogger('scheduler');

/** Wraps a job so one failure is logged and never kills the scheduler. */
function safe(name: string, fn: () => unknown | Promise<unknown>) {
  return async () => {
    try {
      await fn();
    } catch (err) {
      log.error({ job: name, err: errMsg(err) }, 'job failed');
    }
  };
}

export function startScheduler(ctx: AppContext): () => void {
  const tz = ctx.env.TIMEZONE;
  const tasks: ScheduledTask[] = [];
  const timers: NodeJS.Timeout[] = [];

  // --- news: poll every NEWS_POLL_SECONDS, then analyze right away (target: alert within ~1 min) ---
  const newsCycle = safe('news', async () => {
    await pollNews(ctx);
    await analyzePending(ctx);
  });
  timers.push(setInterval(newsCycle, ctx.env.NEWS_POLL_SECONDS * 1000));
  void newsCycle();

  // --- calendar sync + per-minute checks ---
  void safe('calendar-sync', () => syncCalendar(ctx))();
  const everyMinute = safe('minute', async () => {
    await syncCalendar(ctx);
    checkReminders(ctx);
    checkEarlyClose(ctx);
    checkMuteExpiry(ctx);
    await checkReleaseResults(ctx);
  });
  tasks.push(cron.schedule('* * * * *', everyMinute, { name: 'minute', timezone: tz, noOverlap: true }));

  // --- digest every N minutes (outside quiet hours, not while muted, not at briefing time) ---
  const b = parseHHMM(ctx.env.BRIEFING_TIME);
  const digestEvery = Math.max(5, Math.min(60, ctx.env.DIGEST_INTERVAL_MINUTES));
  tasks.push(
    cron.schedule(
      `*/${digestEvery} * * * *`,
      safe('digest', () => {
        const now = nowLocal();
        if (isMuted(ctx.db) || inQuietHours(ctx.env.QUIET_HOURS_START, ctx.env.QUIET_HOURS_END, now)) return;
        const minsFromBriefing = Math.abs(now.hour * 60 + now.minute - (b.hour * 60 + b.minute));
        if (minsFromBriefing < 3) return; // the briefing covers these
        const n = sendDigest(ctx);
        if (n) log.info({ items: n }, 'digest queued');
      }),
      { name: 'digest', timezone: tz },
    ),
  );

  // --- morning briefing (default 7:00 Toronto) ---
  tasks.push(cron.schedule(`${b.minute} ${b.hour} * * *`, safe('briefing', () => sendMorningBriefing(ctx)), { name: 'briefing', timezone: tz }));

  // --- Sunday evening weekly outlook (default 18:00 Toronto) ---
  const w = parseHHMM(ctx.env.WEEKLY_OUTLOOK_TIME);
  tasks.push(
    cron.schedule(
      `${w.minute} ${w.hour} * * 0`,
      safe('weekly', async () => {
        await syncCalendar(ctx, { force: true });
        sendWeeklyOutlook(ctx);
      }),
      { name: 'weekly', timezone: tz },
    ),
  );

  // --- housekeeping ---
  tasks.push(cron.schedule('17 3 * * *', safe('prune', () => pruneOld(ctx.db)), { name: 'prune', timezone: tz }));

  log.info(
    { pollSeconds: ctx.env.NEWS_POLL_SECONDS, digestEvery, briefing: ctx.env.BRIEFING_TIME, weekly: `Sun ${ctx.env.WEEKLY_OUTLOOK_TIME}`, tz },
    'scheduler started',
  );

  return () => {
    timers.forEach(clearInterval);
    tasks.forEach((t) => void t.stop());
  };
}
