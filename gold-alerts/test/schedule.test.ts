import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { parseDuration, handleCommand } from '../src/delivery/commands.js';
import { ownerCommandText } from '../src/delivery/whatsapp.js';
import { checkEarlyClose } from '../src/scheduler/briefings.js';
import { checkReleaseResults, checkReminders, releaseQuery } from '../src/scheduler/calendar-jobs.js';
import { classifyEvent, normalizeEvents, upsertEvents } from '../src/sources/calendar.js';
import { sessionForDate } from '../src/sources/market-hours.js';
import { inQuietHours } from '../src/util/time.js';
import { makeCtx } from './helpers.js';

const ET = 'America/New_York';

describe('economic calendar', () => {
  it('keeps USD high/medium events and promotes key releases', () => {
    expect(classifyEvent({ title: 'Non-Farm Employment Change', country: 'USD', impact: 'High' })).toBe('high');
    expect(classifyEvent({ title: 'Unemployment Claims', country: 'USD', impact: 'Low' })).toBe('medium');
    expect(classifyEvent({ title: 'FOMC Member Williams Speaks', country: 'USD', impact: 'Low' })).toBe('medium');
    expect(classifyEvent({ title: 'CPI y/y', country: 'USD', impact: 'Medium' })).toBe('high');
    expect(classifyEvent({ title: 'CPI y/y', country: 'EUR', impact: 'High' })).toBeNull();
    expect(classifyEvent({ title: 'Crude Oil Inventories', country: 'USD', impact: 'Low' })).toBeNull();
  });

  it('sends one 30-min and one 5-min reminder per release time, grouping simultaneous events', async () => {
    const { ctx, flush } = makeCtx();
    const at = Date.now() + 28 * 60_000;
    const iso = DateTime.fromMillis(at).setZone(ET).toISO()!;
    upsertEvents(
      ctx.db,
      normalizeEvents([
        { title: 'Core PCE Price Index m/m', country: 'USD', date: iso, impact: 'High', forecast: '0.3%', previous: '0.3%' },
        { title: 'Prelim GDP q/q', country: 'USD', date: iso, impact: 'High', forecast: '3.5%', previous: '3.4%' },
      ]),
    );
    checkReminders(ctx, Date.now());
    checkReminders(ctx, Date.now() + 30_000); // next minute: must not repeat
    let sent = await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('28 MIN BAAD');
    expect(sent[0]).toContain('Core PCE Price Index m/m (fcst 0.3%, prev 0.3%)');
    expect(sent[0]).toContain('Prelim GDP q/q');
    checkReminders(ctx, at - 5 * 60_000);
    sent = await flush();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('5 MIN BAAD');
  });

  it('sends actual vs forecast after the release using extracted headline numbers', async () => {
    const { ctx, analyzer, flush } = makeCtx();
    const at = Date.now() - 3 * 60_000;
    upsertEvents(
      ctx.db,
      normalizeEvents([{ title: 'CPI m/m', country: 'USD', date: DateTime.fromMillis(at).setZone(ET).toISO()!, impact: 'High', forecast: '0.3%', previous: '0.2%' }]),
    );
    // No network in unit tests: make the headline search and calendar re-sync fail quietly.
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    ctx.db
      .prepare("INSERT INTO seen_items(url_hash,title_hash,title,norm_title,source,kind,published_at,first_seen,status) VALUES('u','t',?,?,'Reuters','news',?,?,'analyzed')")
      .run('US consumer prices rise 0.5% in October, above forecasts', 'x', Date.now(), Date.now());
    analyzer.release = {
      found: true,
      results: [{ title: 'CPI m/m', actual: '0.5%', vs_forecast: 'above' }],
      gold_bias: 'bearish',
      confidence: 80,
      explanation: 'Hot inflation -> Fed hawkish, yields up -> gold pe pressure.',
    };
    await checkReleaseResults(ctx, Date.now());
    const sent = await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('📊 *DATA OUT* | Gold: BEARISH (80%)');
    expect(sent[0]).toContain('CPI m/m: *0.5%* vs fcst 0.3% (prev 0.2%) ⬆️ forecast se upar');
    await checkReleaseResults(ctx, Date.now() + 5 * 60_000);
    expect(await flush()).toHaveLength(1); // only once
  });

  it('builds a clean news query for a release', () => {
    expect(releaseQuery('Core PCE Price Index m/m')).toBe('US Core PCE Price Index');
    expect(releaseQuery('Prelim GDP q/q')).toBe('US GDP');
  });
});

describe('market hours', () => {
  it('knows Thanksgiving week 2026', () => {
    const { ctx } = makeCtx();
    const hol = ctx.cfg.holidays();
    const fri = sessionForDate(hol, '2026-11-27');
    expect(fri.status).toBe('early_close');
    expect(fri.closesAt!.toFormat('HH:mm')).toBe('13:45');
    expect(fri.reopensAt!.toISODate()).toBe('2026-11-29');
    expect(sessionForDate(hol, '2026-12-25').status).toBe('closed');
    expect(sessionForDate(hol, '2026-11-28').status).toBe('weekend');
    const mon = sessionForDate(hol, '2026-11-30');
    expect(mon.opensAt!.toFormat('ccc HH:mm')).toBe('Sun 18:00');
  });

  it('warns 60 and 15 minutes before an early close, once each', async () => {
    const { ctx, flush } = makeCtx();
    const close = DateTime.fromISO('2026-11-27T13:45', { zone: ET }).toMillis();
    checkEarlyClose(ctx, close - 60 * 60_000);
    checkEarlyClose(ctx, close - 59 * 60_000);
    checkEarlyClose(ctx, close - 15 * 60_000);
    const sent = await flush().then((s) => s);
    // The outbox drops messages past their expiry, so check the queue contents rather than delivery time.
    expect(sent.length).toBeLessThanOrEqual(2);
    const rows = ctx.db.prepare("SELECT text FROM outbox WHERE kind = 'session'").all() as { text: string }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text).toContain('EARLY CLOSE 60 MIN MEIN');
    expect(rows[1]!.text).toContain('EARLY CLOSE 15 MIN MEIN');
  });
});

describe('commands & security', () => {
  it('only accepts commands from the owner number in a direct chat', () => {
    const owner = '15195550000';
    const msg = (key: Record<string, unknown>, text = 'test') => ({ key, message: { conversation: text } }) as never;
    expect(ownerCommandText(msg({ remoteJid: `${owner}@s.whatsapp.net` }), owner)).toBe('test');
    expect(ownerCommandText(msg({ remoteJid: '123456789@lid', remoteJidAlt: `${owner}@s.whatsapp.net` }), owner)).toBe('test');
    expect(ownerCommandText(msg({ remoteJid: '19998887777@s.whatsapp.net' }), owner)).toBeNull();
    expect(ownerCommandText(msg({ remoteJid: '123456789@lid' }), owner)).toBeNull();
    expect(ownerCommandText(msg({ remoteJid: '1203630@g.us', participant: `${owner}@s.whatsapp.net` }), owner)).toBeNull();
    expect(ownerCommandText(msg({ remoteJid: `${owner}@s.whatsapp.net`, fromMe: true }), owner)).toBeNull();
  });

  it('parses mute durations', () => {
    expect(parseDuration('1h')).toBe(3_600_000);
    expect(parseDuration('30m')).toBe(1_800_000);
    expect(parseDuration('2 hours')).toBe(7_200_000);
    expect(parseDuration('')).toBe(3_600_000);
    expect(parseDuration('forever')).toBeNull();
  });

  it('answers test/today/unknown commands', () => {
    const { ctx } = makeCtx();
    expect(handleCommand(ctx, 'test')).toContain('Gold Alert Bot — Status');
    expect(handleCommand(ctx, 'Today')).toContain('Gold Briefing');
    expect(handleCommand(ctx, 'blah')).toContain('Commands');
  });

  it('quiet hours cross midnight', () => {
    const at = (h: number) => DateTime.fromObject({ hour: h }, { zone: 'America/Toronto' });
    expect(inQuietHours('22:00', '07:00', at(23))).toBe(true);
    expect(inQuietHours('22:00', '07:00', at(3))).toBe(true);
    expect(inQuietHours('22:00', '07:00', at(7))).toBe(false);
    expect(inQuietHours('22:00', '07:00', at(15))).toBe(false);
  });
});
