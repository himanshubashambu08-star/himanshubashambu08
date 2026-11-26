import { DateTime } from 'luxon';

/** CME publishes its schedule in US Eastern (= Toronto) time. */
export const EXCHANGE_TZ = 'America/New_York';

let userTz = 'America/Toronto';
export function setUserTimezone(tz: string) {
  userTz = tz;
}
export function getUserTimezone() {
  return userTz;
}

export function nowLocal(): DateTime {
  return DateTime.now().setZone(userTz);
}

export function toLocal(d: Date | number | DateTime): DateTime {
  if (DateTime.isDateTime(d)) return d.setZone(userTz);
  return DateTime.fromMillis(typeof d === 'number' ? d : d.getTime()).setZone(userTz);
}

/** "2:14 PM" */
export function fmtTime(d: Date | number | DateTime): string {
  return toLocal(d).toFormat('h:mm a');
}

/** "Thu, 27 Nov" */
export function fmtDay(d: Date | number | DateTime): string {
  return toLocal(d).toFormat('ccc, d LLL');
}

export function parseHHMM(s: string): { hour: number; minute: number } {
  const [h, m] = s.split(':').map((x) => Number.parseInt(x, 10));
  return { hour: h ?? 0, minute: m ?? 0 };
}

/** True when `now` falls inside [start, end) local time; handles windows crossing midnight. */
export function inQuietHours(start: string, end: string, now: DateTime = nowLocal()): boolean {
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  const cur = now.hour * 60 + now.minute;
  const a = s.hour * 60 + s.minute;
  const b = e.hour * 60 + e.minute;
  if (a === b) return false;
  return a < b ? cur >= a && cur < b : cur >= a || cur < b;
}

export function minutesBetween(a: number, b: number): number {
  return (b - a) / 60000;
}
