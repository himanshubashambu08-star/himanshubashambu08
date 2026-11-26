import type { AppContext } from '../context.js';
import { isMuted, muteUntil, setMute } from '../context.js';
import { allHealth } from '../sources/health.js';
import { buildBriefing, buildWeekly } from '../scheduler/briefings.js';
import { sendDigest } from '../analysis/pipeline.js';
import { fmtTime, toLocal } from '../util/time.js';

const ago = (ms: number | null) => {
  if (!ms) return 'kabhi nahi';
  const m = Math.round((Date.now() - ms) / 60_000);
  return m < 1 ? 'abhi' : m < 60 ? `${m} min pehle` : `${Math.round(m / 60)} ghante pehle`;
};

/** "1h", "30m", "2 hours", "90" (minutes) -> ms. Default 1h. */
export function parseDuration(s: string | undefined): number | null {
  if (!s || !s.trim()) return 60 * 60_000;
  const m = s.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? 'm';
  const mult = unit.startsWith('h') ? 3_600_000 : unit.startsWith('d') ? 86_400_000 : 60_000;
  const ms = n * mult;
  return ms > 0 && ms <= 7 * 86_400_000 ? ms : null;
}

export function statusReport(ctx: AppContext): string {
  const health = allHealth(ctx.db);
  const ok = health.filter((h) => h.consecutive_fails === 0 && h.last_ok);
  const bad = health.filter((h) => h.consecutive_fails > 0);
  const wa = ctx.state.whatsapp();
  const mu = muteUntil(ctx.db);
  const today = toLocal(Date.now()).startOf('day').toMillis();
  const counts = ctx.db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM seen_items WHERE first_seen >= ?) AS seen,
         (SELECT COUNT(*) FROM analyses WHERE created_at >= ?) AS analyzed,
         (SELECT COUNT(*) FROM outbox WHERE kind = 'alert' AND created_at >= ?) AS alerts,
         (SELECT COUNT(*) FROM digest_queue) AS digest`,
    )
    .get(today, today, today) as { seen: number; analyzed: number; alerts: number; digest: number };

  const lines = [
    '🤖 *Gold Alert Bot — Status*',
    `WhatsApp: ${wa.connected ? '✅ connected' : '❌ disconnected'} | Uptime: ${Math.round((Date.now() - ctx.state.startedAt) / 3_600_000)}h`,
    `Last news check: ${ctx.state.lastNewsPoll ? fmtTime(ctx.state.lastNewsPoll) : '-'} (${ago(ctx.state.lastNewsPoll)})`,
    `Calendar sync: ${ago(ctx.state.lastCalendarSync)}${ctx.state.lastCalendarError ? ` ⚠️ ${ctx.state.lastCalendarError}` : ''}`,
    `AI (Claude): ${ctx.state.lastAnalysisError ? `❌ ${ctx.state.lastAnalysisError}` : ctx.state.lastAnalysisOk ? `✅ ok (${ago(ctx.state.lastAnalysisOk)})` : '⏳ abhi tak koi item nahi'}`,
    `Aaj: ${counts.seen} items dekhe, ${counts.analyzed} analyze, ${counts.alerts} 🚨 alerts, ${counts.digest} digest mein waiting`,
    `Mute: ${mu && isMuted(ctx.db) ? `🔕 ${fmtTime(mu)} tak` : '🔔 off'} | Queue: ${ctx.outbox.pending()} msgs`,
    '',
    `*Sources* — ✅ ${ok.length} up, ❌ ${bad.length} down`,
    ...ok.map((h) => `✅ ${h.name} (${ago(h.last_ok)}, ${h.last_count ?? 0} items)`),
    ...bad.map((h) => `❌ ${h.name} — ${h.consecutive_fails}x fail: ${(h.last_error ?? '').slice(0, 80)}`),
  ];
  return lines.join('\n');
}

const HELP = [
  '📖 *Commands*',
  '• test — status report (sources, last check)',
  '• today — aaj ki briefing dobara',
  '• week — is hafte ka outlook',
  '• digest — pending medium updates abhi bhejo',
  '• mute 1h / mute 30m / mute 2h — alerts band',
  '• unmute — alerts wapas on',
].join('\n');

/** Handles a message from the owner. Returns the reply text (sent via the outbox as a command reply). */
export function handleCommand(ctx: AppContext, raw: string): string {
  const text = raw.trim().toLowerCase().replace(/^[/!]/, '');
  const [cmd, ...rest] = text.split(/\s+/);
  switch (cmd) {
    case 'test':
    case 'status':
      return statusReport(ctx);
    case 'today':
    case 'briefing':
      return buildBriefing(ctx);
    case 'week':
    case 'weekly':
      return buildWeekly(ctx);
    case 'digest': {
      const n = sendDigest(ctx, {});
      return n ? `📋 ${n} updates digest mein bhej rahe hain.` : '📋 Abhi koi pending medium update nahi hai.';
    }
    case 'mute': {
      const ms = parseDuration(rest.join(' '));
      if (ms === null) return 'Samjha nahi 🤔 — aise likho: mute 1h, mute 30m, mute 2h';
      const until = Date.now() + ms;
      setMute(ctx.db, until);
      return `🔕 Muted till ${fmtTime(until)}. Is beech ke 🚨 alerts unmute pe ek catch-up digest mein milenge. "unmute" bhej ke jaldi on kar sakte ho.`;
    }
    case 'unmute': {
      const wasMuted = isMuted(ctx.db);
      setMute(ctx.db, null);
      const n = sendDigest(ctx, { title: '📋 *Catch-up* — mute ke dauraan ye aaya:' });
      return wasMuted ? `🔔 Unmuted!${n ? ` ${n} held updates bhej raha hoon.` : ' Mute ke dauraan kuch khaas nahi aaya.'}` : '🔔 Alerts already on hain.';
    }
    case 'help':
    case 'commands':
    case 'hi':
    case 'hello':
      return HELP;
    default:
      return `Ye command nahi pata: "${raw.slice(0, 40)}"\n\n${HELP}`;
  }
}

/** Called every minute: when a timed mute runs out, announce it and send the catch-up digest. */
export function checkMuteExpiry(ctx: AppContext, now = Date.now()): void {
  const until = muteUntil(ctx.db);
  if (until === null || until > now) return;
  setMute(ctx.db, null);
  ctx.outbox.enqueue('system', '🔔 Mute khatam — alerts wapas on.');
  sendDigest(ctx, { title: '📋 *Catch-up* — mute ke dauraan ye aaya:' });
}
