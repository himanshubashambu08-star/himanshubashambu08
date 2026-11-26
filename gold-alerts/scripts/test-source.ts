/**
 * Try one data source on its own, without WhatsApp and without the AI.
 *
 *   npm run test:source calendar
 *   npm run test:source rss            (all enabled feeds)
 *   npm run test:source rss kitco      (feeds whose id contains "kitco")
 *   npm run test:source finnhub
 *   npm run test:source truth
 *   npm run test:source x              (needs ENABLE_X=true)
 *   npm run test:source hours
 *   npm run test:source ai             (sends 3 sample headlines to Claude)
 */
import { loadConfigFiles } from '../src/config/files.js';
import { loadEnv } from '../src/config/env.js';
import { fetchCalendar } from '../src/sources/calendar.js';
import { setUserTimezone, fmtDay, fmtTime } from '../src/util/time.js';

const [which = 'help', filter] = process.argv.slice(2);
const env = loadEnv({ MY_WHATSAPP_NUMBER: process.env.MY_WHATSAPP_NUMBER ?? '10000000000' });
setUserTimezone(env.TIMEZONE);
const cfg = loadConfigFiles(env.configDir);

async function main() {
  switch (which) {
    case 'calendar': {
      const events = await fetchCalendar();
      console.log(`${events.length} USD high/medium events this week:\n`);
      for (const e of events) {
        console.log(
          `${fmtDay(e.atMs).padEnd(12)} ${fmtTime(e.atMs).padStart(8)}  [${e.keyLevel.toUpperCase().padEnd(6)}] ${e.title}` +
            `  (FF: ${e.impact}; fcst ${e.forecast ?? '-'}, prev ${e.previous ?? '-'}, actual ${e.actual ?? '-'})`,
        );
      }
      break;
    }
    case 'rss': {
      const { rssSource } = await import('../src/sources/rss.js');
      const feeds = cfg.feeds().filter((f) => (filter ? f.id.includes(filter) : f.enabled));
      const results = await Promise.allSettled(feeds.map((f) => rssSource(f).fetch()));
      results.forEach((r, i) => {
        const f = feeds[i]!;
        if (r.status === 'rejected') {
          console.log(`✗ ${f.id.padEnd(24)} FAILED: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
          return;
        }
        const newest = r.value.reduce((m, x) => Math.max(m, x.publishedAt.getTime()), 0);
        const ageMin = newest ? Math.round((Date.now() - newest) / 60000) : NaN;
        console.log(`✓ ${f.id.padEnd(24)} ${String(r.value.length).padStart(3)} items, newest ${ageMin} min ago`);
        for (const it of r.value.slice(0, 2)) console.log(`     - ${it.title.slice(0, 110)}`);
      });
      break;
    }
    case 'finnhub': {
      const { finnhubSource } = await import('../src/sources/finnhub.js');
      if (!env.FINNHUB_API_KEY) {
        console.log('FINNHUB_API_KEY is not set in .env, so the bot skips Finnhub (RSS still runs).');
        break;
      }
      for (const cat of ['general', 'forex'] as const) {
        const items = await finnhubSource(env.FINNHUB_API_KEY, cat).fetch();
        console.log(`✓ finnhub:${cat} ${items.length} items`);
        for (const it of items.slice(0, 3)) console.log(`     - [${it.source}] ${it.title.slice(0, 100)}`);
      }
      break;
    }
    case 'truth':
    case 'x': {
      const { truthSocialSource, xSource } = await import('../src/sources/social.js');
      const social = cfg.social();
      const sources =
        which === 'truth'
          ? social.truthSocial.filter((a) => a.enabled).map(truthSocialSource)
          : social.x.filter((a) => a.enabled && (!filter || a.handle.includes(filter))).map((a) => xSource(a, env.X_RSS_URL_TEMPLATE));
      if (which === 'x' && !env.ENABLE_X) console.log('(note: ENABLE_X is false, so the bot itself will not run these)\n');
      for (const s of sources) {
        try {
          const items = await s.fetch();
          console.log(`✓ ${s.name}: ${items.length} text posts`);
          for (const it of items.slice(0, 4)) console.log(`     - ${it.publishedAt.toISOString()} ${it.title.slice(0, 120)}`);
        } catch (err) {
          console.log(`✗ ${s.name} FAILED: ${err instanceof Error ? err.message : err}`);
        }
      }
      break;
    }
    case 'ai': {
      const { Analyzer } = await import('../src/analysis/claude.js');
      const a = new Analyzer(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL);
      const now = Date.now();
      const res = await a.analyzeBatch([
        { index: 0, source: 'Truth Social', kind: 'social', publishedAt: now, title: 'I am pausing all new tariffs on China for 90 days while we negotiate a great deal!' },
        { index: 1, source: 'Reuters', kind: 'news', publishedAt: now, title: 'Iran launches ballistic missiles at Israeli military bases, explosions heard in Tel Aviv' },
        { index: 2, source: 'AP', kind: 'news', publishedAt: now, title: 'Local high school wins state football championship' },
      ]);
      for (const [i, r] of res) console.log(i, JSON.stringify(r, null, 1));
      break;
    }
    case 'hours': {
      const { sessionForDate, holidaysBetween } = await import('../src/sources/market-hours.js');
      const { DateTime } = await import('luxon');
      const hol = cfg.holidays();
      const start = DateTime.now().setZone(hol.timezone).startOf('day');
      for (let i = 0; i < 10; i++) {
        const d = start.plus({ days: i }).toISODate()!;
        const s = sessionForDate(hol, d);
        const f = (x: typeof s.opensAt) => (x ? x.setZone(env.TIMEZONE).toFormat('ccc h:mm a') : '-');
        console.log(
          `${d}  ${s.status.padEnd(12)} open ${f(s.opensAt).padEnd(13)} close ${f(s.closesAt).padEnd(13)} reopen ${f(s.reopensAt).padEnd(13)} ${s.holiday?.name ?? ''}`,
        );
      }
      console.log('\nHolidays in next 60 days:', holidaysBetween(hol, start.toISODate()!, start.plus({ days: 60 }).toISODate()!).map((h) => `${h.date} ${h.name}`));
      break;
    }
    default:
      console.log('Usage: npm run test:source <calendar|rss|finnhub|truth|x|hours|ai> [filter]');
  }
  void cfg;
}

main().catch((err) => {
  console.error('FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
