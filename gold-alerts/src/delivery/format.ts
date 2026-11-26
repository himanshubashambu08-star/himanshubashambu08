import type { DateTime } from 'luxon';
import type { ItemAnalysis, ReleaseResult } from '../analysis/claude.js';
import type { CalendarEvent } from '../sources/calendar.js';
import type { DaySession } from '../sources/market-hours.js';
import type { HolidayDay } from '../config/files.js';
import { fmtDay, fmtTime, toLocal } from '../util/time.js';

export type Bias = ItemAnalysis['gold_bias'];

const BIAS_DOT: Record<Bias, string> = { bullish: '🟢', bearish: '🔴', neutral: '⚪' };

export interface AlertItem {
  title: string;
  source: string;
  alsoSources?: string | null;
  publishedAt: number;
  analysis: Pick<ItemAnalysis, 'impact' | 'gold_bias' | 'confidence' | 'headline_hinglish' | 'explanation'>;
}

/** "Truth Social|Donald Trump" -> "Truth Social"; adds other outlets that ran the same story. */
function sourceLabel(source: string, also?: string | null): string {
  const main = source.split('|')[0] ?? source;
  const others = (also ?? '')
    .split(',')
    .map((s) => s.split('|')[0]?.trim())
    .filter((s): s is string => !!s && s !== main);
  const uniq = [...new Set(others)].slice(0, 3);
  return uniq.length ? `${main} (+${uniq.join(', ')})` : main;
}

/**
 * 🚨 HIGH IMPACT | Gold: BEARISH (75%)
 * Trump ne Truth Social pe tariff pause announce kiya.
 * Risk-on mood -> safe haven demand kam, gold pe pressure aa sakta hai.
 * Source: Truth Social | 2:14 PM
 */
export function formatHighAlert(it: AlertItem): string {
  const a = it.analysis;
  return [
    `🚨 HIGH IMPACT | Gold: ${a.gold_bias.toUpperCase()} (${a.confidence}%)`,
    a.headline_hinglish.trim(),
    a.explanation.trim(),
    `Source: ${sourceLabel(it.source, it.alsoSources)} | ${fmtTime(it.publishedAt)}`,
  ].join('\n');
}

function digestLine(i: number, it: AlertItem): string {
  const a = it.analysis;
  const tag = a.impact === 'high' ? '🚨 ' : '';
  return [
    `${i}. ${tag}${BIAS_DOT[a.gold_bias]} ${a.gold_bias.toUpperCase()} (${a.confidence}%) — ${a.headline_hinglish.trim()}`,
    `   ${a.explanation.trim()}`,
    `   _${sourceLabel(it.source, it.alsoSources)}, ${fmtTime(it.publishedAt)}_`,
  ].join('\n');
}

export function formatDigest(items: AlertItem[], opts: { title?: string; more?: number } = {}): string {
  const title = opts.title ?? `📋 *Gold Digest* (${fmtTime(Date.now())}) — ${items.length} update${items.length === 1 ? '' : 's'}`;
  const lines = items.map((it, i) => digestLine(i + 1, it));
  const tally = biasTally(items);
  const footer = [`Overall tilt: ${tally}`];
  if (opts.more) footer.push(`(+${opts.more} aur updates agle digest mein)`);
  return [title, '', lines.join('\n\n'), '', ...footer].join('\n');
}

export function biasTally(items: AlertItem[]): string {
  const c = { bullish: 0, bearish: 0, neutral: 0 };
  for (const it of items) c[it.analysis.gold_bias]++;
  return `🟢 ${c.bullish} bullish · 🔴 ${c.bearish} bearish · ⚪ ${c.neutral} neutral`;
}

// ---------- calendar ----------

function eventLine(e: CalendarEvent): string {
  const bits = [e.forecast ? `fcst ${e.forecast}` : null, e.previous ? `prev ${e.previous}` : null].filter(Boolean);
  return `${e.title}${bits.length ? ` (${bits.join(', ')})` : ''}`;
}

export function formatReminder(group: CalendarEvent[], minutes: number): string {
  const at = group[0]!.atMs;
  return [
    `⏰ *${minutes} MIN BAAD* | USD High Impact @ ${fmtTime(at)}`,
    ...group.map((e) => `• ${eventLine(e)}`),
    minutes <= 5
      ? 'Release ke time spreads wide aur spikes fast hote hain — SL/position size check kar lo.'
      : 'Volatility expected. Pehle se plan bana lo: forecast se upar = USD strong (gold pe pressure), neeche = gold ko support.',
  ].join('\n');
}

function arrow(v: 'above' | 'below' | 'inline' | 'unknown'): string {
  return v === 'above' ? '⬆️ forecast se upar' : v === 'below' ? '⬇️ forecast se neeche' : v === 'inline' ? '↔️ forecast ke barabar' : '';
}

export function formatReleaseResult(group: CalendarEvent[], r: ReleaseResult): string {
  const lines = group.map((e) => {
    const res = r.results.find((x) => x.title.toLowerCase() === e.title.toLowerCase());
    const actual = e.actual ?? (res?.actual || '?');
    const cmp = res ? arrow(res.vs_forecast) : '';
    return `• ${e.title}: *${actual}* vs fcst ${e.forecast ?? '-'} (prev ${e.previous ?? '-'}) ${cmp}`.trim();
  });
  return [
    `📊 *DATA OUT* | Gold: ${r.gold_bias.toUpperCase()} (${Math.max(0, Math.min(100, r.confidence))}%)`,
    ...lines,
    r.explanation.trim(),
    `Release: ${fmtTime(group[0]!.atMs)} | Actuals from news headlines — chart se confirm karein`,
  ].join('\n');
}

export function formatReleaseNotFound(group: CalendarEvent[]): string {
  return [
    `📊 ${group.map((e) => e.title).join(', ')} release ho gaya (${fmtTime(group[0]!.atMs)}).`,
    'Actual number abhi kisi news source mein confirm nahi mila — ForexFactory/chart pe check kar lo.',
  ].join('\n');
}

// ---------- market hours ----------

const t = (d: DateTime | null) => (d ? toLocal(d).toFormat('ccc h:mm a') : '-');

export function formatSession(s: DaySession): string {
  switch (s.status) {
    case 'closed':
      return `🔒 Gold market aaj BAND hai (${s.holiday?.name}). Reopen: ${t(s.reopensAt)}`;
    case 'weekend':
      return `🛌 Weekend — gold market band. Reopen: ${t(s.reopensAt)}`;
    case 'sunday_open':
      return `🔔 Gold market aaj ${t(s.opensAt)} pe open hoga (weekly open — gaps possible).`;
    case 'early_close':
      return [
        `⚠️ EARLY CLOSE aaj (${s.holiday?.name}${s.holiday?.verify ? ', time verify karein' : ''})`,
        `Open since ${t(s.opensAt)} → band ${t(s.closesAt)}`,
        `Reopen: ${t(s.reopensAt)}. Liquidity kam rahegi.`,
      ].join('\n');
    default:
      return `🕐 Normal session: ${t(s.opensAt)} → ${t(s.closesAt)} (daily break ${t(s.closesAt)}–${t(s.reopensAt)})`;
  }
}

export function formatEarlyCloseWarning(s: DaySession, minutes: number): string {
  return [
    `⚠️ *EARLY CLOSE ${minutes} MIN MEIN* | Gold (COMEX/Globex)`,
    `Aaj ${t(s.closesAt)} pe trading band ho jayegi (${s.holiday?.name}).`,
    `Reopen: ${t(s.reopensAt)}. Open positions aur pending orders check kar lo.`,
  ].join('\n');
}

// ---------- briefings ----------

export interface BriefingInput {
  now: DateTime;
  session: DaySession;
  events: CalendarEvent[];
  headlines: AlertItem[];
  moreHeadlines: number;
  notes: string[];
}

export function formatBriefing(b: BriefingInput): string {
  const ev = b.events.length
    ? b.events.map((e) => `• ${fmtTime(e.atMs)} ${e.keyLevel === 'high' ? '🔴' : '🟠'} ${eventLine(e)}`).join('\n')
    : 'Aaj koi bada USD event nahi hai.';
  const heads = b.headlines.length
    ? b.headlines
        .map(
          (h, i) =>
            `${i + 1}. ${BIAS_DOT[h.analysis.gold_bias]} ${h.analysis.gold_bias.toUpperCase()} (${h.analysis.confidence}%) — ${h.analysis.headline_hinglish.trim()} _(${sourceLabel(h.source)})_`,
        )
        .join('\n')
    : 'Raat mein koi khaas gold-moving news nahi aayi.';
  return [
    `☀️ *Good Morning! Gold Briefing* — ${b.now.toFormat('cccc, d LLL')}`,
    '',
    formatSession(b.session),
    '',
    `📅 *Aaj ke USD events* (Toronto time):`,
    ev,
    '',
    `📰 *Overnight top headlines:*`,
    heads,
    ...(b.moreHeadlines > 0 ? [`(+${b.moreHeadlines} minor updates)`] : []),
    ...(b.headlines.length ? ['', `Overall tilt: ${biasTally(b.headlines)}`] : []),
    ...(b.notes.length ? ['', ...b.notes] : []),
  ].join('\n');
}

export function formatWeekly(events: CalendarEvent[], holidays: HolidayDay[], weekLabel: string): string {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const k = fmtDay(e.atMs);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const days = [...byDay.entries()].map(
    ([day, list]) => `*${day}*\n${list.map((e) => `  ${fmtTime(e.atMs)} ${e.keyLevel === 'high' ? '🔴' : '🟠'} ${eventLine(e)}`).join('\n')}`,
  );
  const high = events.filter((e) => e.keyLevel === 'high').length;
  const hol = holidays.length
    ? holidays
        .map((h) => `• ${h.date}: ${h.name} — ${h.type === 'closed' ? 'market BAND' : `early close ${h.close} ET`}${h.verify ? ' (verify)' : ''}`)
        .join('\n')
    : 'Is hafte koi CME holiday nahi.';
  return [
    `🗓️ *Weekly Gold Outlook* — ${weekLabel}`,
    `Is hafte ${high} high-impact USD event${high === 1 ? '' : 's'} hain.`,
    '',
    days.length ? days.join('\n\n') : 'Calendar mein abhi koi high/medium USD event nahi mila.',
    '',
    `🏦 *CME Holidays / Early close:*`,
    hol,
    '',
    'Har high-impact event se 30 aur 5 min pehle reminder aayega. 👍',
  ].join('\n');
}
