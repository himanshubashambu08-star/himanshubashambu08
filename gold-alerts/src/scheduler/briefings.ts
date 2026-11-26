import { DateTime } from 'luxon';
import type { AppContext } from '../context.js';
import { claimFlag } from '../storage/db.js';
import { eventsBetween } from '../sources/calendar.js';
import { earlyCloseOn, hasHolidayDataFor, holidaysBetween, sessionForDate } from '../sources/market-hours.js';
import { formatBriefing, formatEarlyCloseWarning, formatWeekly } from '../delivery/format.js';
import { digestCandidates, topHeadlinesSince } from '../analysis/pipeline.js';
import { nowLocal } from '../util/time.js';

/** Morning briefing: session hours/holiday, today's USD events, top overnight headlines. */
export function buildBriefing(ctx: AppContext, now: DateTime = nowLocal()): string {
  const hol = ctx.cfg.holidays();
  const todayET = now.setZone(hol.timezone).toISODate()!;
  const session = sessionForDate(hol, todayET);
  const dayStart = now.startOf('day').toMillis();
  const events = eventsBetween(ctx.db, dayStart, dayStart + 86_400_000);
  const overnightSince = now.minus({ days: 1 }).set({ hour: 17, minute: 0, second: 0 }).toMillis();
  const { items, total } = topHeadlinesSince(ctx, overnightSince, 5);

  const notes: string[] = [];
  const nextYear = now.year + 1;
  if (now.month >= 11 && !hasHolidayDataFor(hol, nextYear)) {
    notes.push(`ℹ️ config/cme-holidays.json mein ${nextYear} ke CME holidays nahi hain — please update kar do.`);
  }
  if (events.length === 0 && ctx.state.lastCalendarSync === null) {
    notes.push('⚠️ Economic calendar abhi load nahi hua — "test" bhej ke status dekho.');
  }
  return formatBriefing({ now, session, events, headlines: items, moreHeadlines: Math.max(0, total - items.length), notes });
}

/** 7:00 AM job. The briefing replaces the overnight digest, so the digest queue is cleared. */
export function sendMorningBriefing(ctx: AppContext): void {
  const today = nowLocal().toISODate()!;
  if (!claimFlag(ctx.db, `briefing:${today}`)) return;
  ctx.outbox.enqueue('briefing', buildBriefing(ctx));
  const { ids } = digestCandidates(ctx);
  const del = ctx.db.prepare('DELETE FROM digest_queue WHERE item_id = ?');
  ctx.db.transaction(() => ids.forEach((id) => del.run(id)))();
}

/** Sunday evening: week's major USD events and any CME holidays. */
export function buildWeekly(ctx: AppContext, now: DateTime = nowLocal()): string {
  const hol = ctx.cfg.holidays();
  // On Sunday the "coming week" is Mon..Sun; any other day, the rest of this week (until next Monday 00:00).
  const start = now.weekday === 7 ? now.plus({ days: 1 }).startOf('day') : now.startOf('day');
  const end = now.weekday === 7 ? start.plus({ days: 7 }) : now.startOf('day').plus({ days: 8 - now.weekday });
  const events = eventsBetween(ctx.db, now.toMillis(), end.toMillis());
  const holidays = holidaysBetween(hol, now.toISODate()!, end.toISODate()!);
  const label = `${start.toFormat('d LLL')} – ${end.minus({ days: 1 }).toFormat('d LLL')}`;
  return formatWeekly(events, holidays, label);
}

export function sendWeeklyOutlook(ctx: AppContext): void {
  const key = `weekly:${nowLocal().toISODate()}`;
  if (!claimFlag(ctx.db, key)) return;
  ctx.outbox.enqueue('weekly', buildWeekly(ctx));
}

/** 60- and 15-minute warnings before a CME early close. Runs every minute. */
export function checkEarlyClose(ctx: AppContext, now = Date.now()): void {
  const hol = ctx.cfg.holidays();
  const today = DateTime.fromMillis(now).setZone(hol.timezone).toISODate()!;
  const close = earlyCloseOn(hol, today);
  if (!close) return;
  const mins = (close.toMillis() - now) / 60_000;
  const session = sessionForDate(hol, today);
  if (mins <= 60 && mins > 16 && claimFlag(ctx.db, `earlyclose60:${today}`)) {
    ctx.outbox.enqueue('session', formatEarlyCloseWarning(session, Math.round(mins)), { expiresAt: close.toMillis() });
  } else if (mins <= 15 && mins > 0.5 && claimFlag(ctx.db, `earlyclose15:${today}`)) {
    claimFlag(ctx.db, `earlyclose60:${today}`);
    ctx.outbox.enqueue('session', formatEarlyCloseWarning(session, Math.max(1, Math.round(mins))), { expiresAt: close.toMillis() });
  }
}
