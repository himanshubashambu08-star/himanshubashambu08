import { DateTime } from 'luxon';
import type { HolidayDay, HolidaysConfig } from '../config/files.js';
import { parseHHMM } from '../util/time.js';

export type SessionStatus = 'normal' | 'early_close' | 'closed' | 'weekend' | 'sunday_open';

export interface DaySession {
  /** Calendar date (exchange time zone) this describes, yyyy-MM-dd. */
  date: string;
  status: SessionStatus;
  holiday?: HolidayDay;
  /** When the session that trades into this day opened (null if closed all day). */
  opensAt: DateTime | null;
  /** When trading halts on this day (null if closed all day). */
  closesAt: DateTime | null;
  /** Next time trading resumes after `closesAt` (or after the closure). */
  reopensAt: DateTime | null;
}

function at(date: DateTime, hhmm: string): DateTime {
  const { hour, minute } = parseHHMM(hhmm);
  return date.set({ hour, minute, second: 0, millisecond: 0 });
}

/**
 * Works out gold's Globex session for one calendar day.
 * Normal Mon–Thu: trades from 18:00 the previous evening to 17:00, reopens 18:00.
 * Friday closes 17:00 and reopens Sunday 18:00. Holidays come from config/cme-holidays.json.
 */
export function sessionForDate(cfg: HolidaysConfig, dateISO: string): DaySession {
  const tz = cfg.timezone;
  const day = DateTime.fromISO(dateISO, { zone: tz }).startOf('day');
  const holiday = cfg.days.find((d) => d.date === dateISO);
  const prev = day.minus({ days: 1 });
  const prevHoliday = cfg.days.find((d) => d.date === prev.toISODate());
  const r = cfg.regular;

  // Opening of the session that trades into `day`.
  let opensAt: DateTime | null = at(prev, r.dailyReopen);
  if (prevHoliday) {
    const reopen = DateTime.fromISO(prevHoliday.reopen, { zone: tz });
    opensAt = reopen < day.plus({ days: 1 }) ? reopen : null;
  }

  if (holiday?.type === 'closed') {
    return { date: dateISO, status: 'closed', holiday, opensAt: null, closesAt: null, reopensAt: DateTime.fromISO(holiday.reopen, { zone: tz }) };
  }
  if (holiday?.type === 'early_close' && holiday.close) {
    return {
      date: dateISO,
      status: 'early_close',
      holiday,
      opensAt,
      closesAt: at(day, holiday.close),
      reopensAt: DateTime.fromISO(holiday.reopen, { zone: tz }),
    };
  }

  const wd = day.weekday; // 1=Mon .. 7=Sun
  if (wd === 6) {
    return { date: dateISO, status: 'weekend', opensAt: null, closesAt: null, reopensAt: at(day.plus({ days: 1 }), r.sundayOpen) };
  }
  if (wd === 7) {
    return { date: dateISO, status: 'sunday_open', opensAt: at(day, r.sundayOpen), closesAt: null, reopensAt: null };
  }
  if (wd === 1) opensAt = prevHoliday ? opensAt : at(prev, r.sundayOpen);
  if (wd === 5) {
    return { date: dateISO, status: 'normal', opensAt, closesAt: at(day, r.fridayClose), reopensAt: at(day.plus({ days: 2 }), r.sundayOpen) };
  }
  return { date: dateISO, status: 'normal', opensAt, closesAt: at(day, r.dailyClose), reopensAt: at(day, r.dailyReopen) };
}

/** Holidays (closed or early close) in [fromISO, toISO]. */
export function holidaysBetween(cfg: HolidaysConfig, fromISO: string, toISO: string): HolidayDay[] {
  return cfg.days.filter((d) => d.date >= fromISO && d.date <= toISO).sort((a, b) => a.date.localeCompare(b.date));
}

/** Early-close times on a given day, for the 60/15-minute warnings. */
export function earlyCloseOn(cfg: HolidaysConfig, dateISO: string): DateTime | null {
  const s = sessionForDate(cfg, dateISO);
  return s.status === 'early_close' ? s.closesAt : null;
}

/** Whether there is any holiday entry for the coming year, so we can warn when the file needs updating. */
export function hasHolidayDataFor(cfg: HolidaysConfig, year: number): boolean {
  return cfg.days.some((d) => d.date.startsWith(`${year}-`));
}
