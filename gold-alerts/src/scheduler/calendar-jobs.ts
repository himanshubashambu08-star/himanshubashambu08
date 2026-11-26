import type { AppContext } from '../context.js';
import { claimFlag, getSetting, hasFlag, setSetting } from '../storage/db.js';
import { eventsBetween, fetchCalendar, groupByTime, setActual, upsertEvents, type CalendarEvent } from '../sources/calendar.js';
import { runIsolated } from '../sources/health.js';
import { parseFeed } from '../sources/rss.js';
import { formatReleaseNotFound, formatReleaseResult, formatReminder } from '../delivery/format.js';
import { httpGet } from '../util/http.js';
import { childLogger, errMsg } from '../util/logger.js';

const log = childLogger('calendar');

/** ForexFactory's mirror throttles aggressive polling, so we sync every ~15 min (plus a few forced syncs right after releases). */
export async function syncCalendar(ctx: AppContext, { force = false } = {}): Promise<void> {
  const last = Number(getSetting(ctx.db, 'calendar_last_fetch') ?? 0);
  if (!force && Date.now() - last < ctx.env.CALENDAR_SYNC_MINUTES * 60_000 - 5_000) return;
  if (force && Date.now() - last < 120_000) return; // never hit the feed more than once per 2 min
  setSetting(ctx.db, 'calendar_last_fetch', String(Date.now()));
  const events = await runIsolated<CalendarEvent>(ctx.db, 'calendar:forexfactory', () => fetchCalendar());
  if (events.length) {
    upsertEvents(ctx.db, events);
    ctx.state.lastCalendarSync = Date.now();
    ctx.state.lastCalendarError = null;
  } else {
    ctx.state.lastCalendarError = 'calendar fetch returned nothing (see source health)';
  }
}

/** 30- and 5-minute reminders before high-impact USD releases. Runs every minute. */
export function checkReminders(ctx: AppContext, now = Date.now()): void {
  const upcoming = eventsBetween(ctx.db, now, now + 31 * 60_000).filter((e) => e.keyLevel === 'high');
  for (const group of groupByTime(upcoming)) {
    const at = group[0]!.atMs;
    const mins = (at - now) / 60_000;
    // Windows (not exact minutes) so a restart or a slow tick never skips a reminder.
    if (mins <= 30 && mins > 6 && claimFlag(ctx.db, `remind30:${at}`)) {
      ctx.outbox.enqueue('reminder', formatReminder(group, Math.round(mins)), { expiresAt: at });
    } else if (mins <= 5.5 && mins > 0.5 && claimFlag(ctx.db, `remind5:${at}`)) {
      claimFlag(ctx.db, `remind30:${at}`); // don't send a "30 min" after the "5 min"
      ctx.outbox.enqueue('reminder', formatReminder(group, Math.max(1, Math.round(mins))), { expiresAt: at });
    }
  }
}

/** Builds a Google News query for a release, e.g. "Core PCE Price Index m/m" -> "US Core PCE Price Index". */
export function releaseQuery(title: string): string {
  const core = title
    .replace(/\b[mqy]\/[mqy]\b/gi, '')
    .replace(/\bPrelim\b|\bFlash\b|\bFinal\b|\bRevised\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `US ${core}`;
}

async function freshHeadlines(ctx: AppContext, group: CalendarEvent[]): Promise<string[]> {
  const since = group[0]!.atMs - 5 * 60_000;
  const local = ctx.db
    .prepare('SELECT title FROM seen_items WHERE published_at >= ? OR first_seen >= ? ORDER BY id DESC LIMIT 80')
    .all(since, since) as { title: string }[];
  const searched: string[] = [];
  for (const e of group) {
    const q = encodeURIComponent(`${releaseQuery(e.title)} when:1h`);
    const items = await runIsolated(ctx.db, 'calendar:release-search', async () =>
      parseFeed(await httpGet(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`), 'Google News'),
    );
    searched.push(...items.filter((i) => i.publishedAt.getTime() >= since).map((i) => i.title));
  }
  return [...new Set([...searched, ...local.map((r) => r.title)])].slice(0, 60);
}

/**
 * After a high-impact release: get the actual figures and send "actual vs forecast" with the gold bias.
 * The free ForexFactory JSON normally has no actuals, so we read fresh headlines (Google News + everything
 * the bot already collected) and let Claude extract the numbers. Tries for ~20 minutes.
 */
export async function checkReleaseResults(ctx: AppContext, now = Date.now()): Promise<void> {
  const recent = eventsBetween(ctx.db, now - 25 * 60_000, now - 60_000).filter((e) => e.keyLevel === 'high');
  for (const group of groupByTime(recent)) {
    const at = group[0]!.atMs;
    const doneKey = `result:${at}`;
    if (hasFlag(ctx.db, doneKey)) continue;
    const attemptKey = `result_attempt:${at}`;
    const lastAttempt = Number(getSetting(ctx.db, attemptKey) ?? 0);
    if (now - lastAttempt < 2 * 60_000) continue;
    setSetting(ctx.db, attemptKey, String(now));

    try {
      await syncCalendar(ctx, { force: true }); // picks up actuals if the feed ever carries them
      const fresh = eventsBetween(ctx.db, at, at + 1).filter((e) => e.keyLevel === 'high');
      const headlines = await freshHeadlines(ctx, fresh);
      const allHaveActual = fresh.every((e) => e.actual);
      const result = headlines.length || allHaveActual ? await ctx.analyzer.extractRelease(fresh, headlines) : null;

      if (result && (result.found || allHaveActual)) {
        for (const r of result.results) {
          const ev = fresh.find((e) => e.title.toLowerCase() === r.title.toLowerCase());
          if (ev && r.actual && !ev.actual) setActual(ctx.db, ev.id, r.actual);
        }
        const updated = eventsBetween(ctx.db, at, at + 1).filter((e) => e.keyLevel === 'high');
        if (claimFlag(ctx.db, doneKey)) ctx.outbox.enqueue('result', formatReleaseResult(updated, result));
        log.info({ events: updated.map((e) => e.title) }, 'release result sent');
      } else if (now - at > 20 * 60_000) {
        if (claimFlag(ctx.db, doneKey)) ctx.outbox.enqueue('result', formatReleaseNotFound(fresh));
        log.warn({ events: fresh.map((e) => e.title) }, 'gave up finding release actuals');
      }
    } catch (err) {
      log.warn({ err: errMsg(err) }, 'release result check failed; will retry');
    }
  }
}
