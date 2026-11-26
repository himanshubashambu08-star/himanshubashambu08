import crypto from 'node:crypto';
import type { DB } from '../storage/db.js';
import { httpGetJson } from '../util/http.js';

export const FF_THIS_WEEK_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

/** Shape published by ForexFactory's free weekly JSON. Note: it usually carries no "actual" value. */
export interface FFEvent {
  title: string;
  country: string;
  date: string; // ISO with offset, US Eastern
  impact: 'High' | 'Medium' | 'Low' | 'Holiday' | string;
  forecast?: string;
  previous?: string;
  actual?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  country: string;
  impact: string;
  keyLevel: 'high' | 'medium';
  atMs: number;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
}

/** Releases that move gold a lot even when ForexFactory labels them lower. */
const ALWAYS_HIGH = [
  /non-?farm/i,
  /\bCPI\b/i,
  /\bPPI\b/i,
  /core pce/i,
  /\bPCE\b/i,
  /\bGDP\b/i,
  /federal funds rate/i,
  /FOMC (statement|press conference|economic projections|meeting minutes)/i,
  /fed chair/i,
  /powell/i,
  /unemployment rate/i,
];

/** Lower-labelled USD events the trader still wants to see (Fed speakers, jobless claims, ...). */
const ALWAYS_MEDIUM = [/FOMC member/i, /\bfed\b.*speaks/i, /unemployment claims/i, /jobless claims/i, /ISM/i, /retail sales/i, /JOLTS/i, /ADP/i];

export function classifyEvent(e: Pick<FFEvent, 'title' | 'country' | 'impact'>): 'high' | 'medium' | null {
  if (e.country !== 'USD') return null;
  if (e.impact === 'Holiday') return 'medium';
  if (e.impact === 'High' || ALWAYS_HIGH.some((r) => r.test(e.title))) return 'high';
  if (e.impact === 'Medium' || ALWAYS_MEDIUM.some((r) => r.test(e.title))) return 'medium';
  return null;
}

export function eventId(e: Pick<FFEvent, 'title' | 'country' | 'date'>): string {
  return crypto.createHash('sha1').update(`${e.country}|${e.title}|${e.date}`).digest('hex').slice(0, 16);
}

const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export function normalizeEvents(raw: FFEvent[]): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const e of raw) {
    const level = classifyEvent(e);
    if (!level) continue;
    const atMs = Date.parse(e.date);
    if (Number.isNaN(atMs)) continue;
    out.push({
      id: eventId(e),
      title: e.title,
      country: e.country,
      impact: e.impact,
      keyLevel: level,
      atMs,
      forecast: clean(e.forecast),
      previous: clean(e.previous),
      actual: clean(e.actual),
    });
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

export async function fetchCalendar(url = FF_THIS_WEEK_URL): Promise<CalendarEvent[]> {
  const raw = await httpGetJson<FFEvent[]>(url, { timeoutMs: 20_000 });
  if (!Array.isArray(raw)) throw new Error('calendar feed did not return a list');
  return normalizeEvents(raw);
}

export function upsertEvents(db: DB, events: CalendarEvent[]): void {
  const stmt = db.prepare(
    `INSERT INTO calendar_events(id, title, country, impact, key_level, at_ms, forecast, previous, actual, updated_at)
     VALUES(@id, @title, @country, @impact, @keyLevel, @atMs, @forecast, @previous, @actual, @now)
     ON CONFLICT(id) DO UPDATE SET impact = excluded.impact, key_level = excluded.key_level,
       forecast = excluded.forecast, previous = excluded.previous,
       actual = COALESCE(excluded.actual, calendar_events.actual), updated_at = excluded.updated_at`,
  );
  const now = Date.now();
  db.transaction(() => {
    for (const e of events) stmt.run({ ...e, now });
  })();
}

interface Row {
  id: string;
  title: string;
  country: string;
  impact: string;
  key_level: 'high' | 'medium';
  at_ms: number;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
}

const fromRow = (r: Row): CalendarEvent => ({
  id: r.id,
  title: r.title,
  country: r.country,
  impact: r.impact,
  keyLevel: r.key_level,
  atMs: r.at_ms,
  forecast: r.forecast,
  previous: r.previous,
  actual: r.actual,
});

export function eventsBetween(db: DB, fromMs: number, toMs: number): CalendarEvent[] {
  return (db.prepare('SELECT * FROM calendar_events WHERE at_ms >= ? AND at_ms < ? ORDER BY at_ms, title').all(fromMs, toMs) as Row[]).map(
    fromRow,
  );
}

export function setActual(db: DB, id: string, actual: string): void {
  db.prepare('UPDATE calendar_events SET actual = ?, updated_at = ? WHERE id = ?').run(actual, Date.now(), id);
}

/** Events that share a release time are reminded/reported together (e.g. GDP + Core PCE at 8:30). */
export function groupByTime(events: CalendarEvent[]): CalendarEvent[][] {
  const map = new Map<number, CalendarEvent[]>();
  for (const e of events) {
    const g = map.get(e.atMs) ?? [];
    g.push(e);
    map.set(e.atMs, g);
  }
  return [...map.values()];
}
