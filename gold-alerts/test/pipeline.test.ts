import { describe, expect, it } from 'vitest';
import { analyzePending, sendDigest } from '../src/analysis/pipeline.js';
import { recordItem } from '../src/analysis/dedupe.js';
import { setMute } from '../src/context.js';
import { handleCommand } from '../src/delivery/commands.js';
import type { NewsItem } from '../src/sources/types.js';
import { makeCtx } from './helpers.js';

const news = (title: string, source = 'Reuters', minsAgo = 2): NewsItem => ({
  title,
  source,
  url: `https://example.com/${source}/${encodeURIComponent(title)}`,
  publishedAt: new Date(Date.now() - minsAgo * 60_000),
  kind: 'news',
});

const HIGH = {
  relevant: true,
  impact: 'high' as const,
  gold_bias: 'bearish' as const,
  confidence: 75,
  headline_hinglish: 'Trump ne Truth Social pe tariff pause announce kiya.',
  explanation: 'Risk-on mood -> safe haven demand kam, gold pe pressure aa sakta hai.',
};
const MEDIUM = { ...HIGH, impact: 'medium' as const, gold_bias: 'bullish' as const, confidence: 60, headline_hinglish: 'Fed speaker ne dovish hint diya.', explanation: 'Rate cut bets -> gold ko support.' };

describe('news pipeline', () => {
  it('sends high-impact items instantly in the requested format', async () => {
    const { ctx, analyzer, flush } = makeCtx();
    analyzer.rules.push({ match: /tariff/i, result: HIGH });
    recordItem(ctx.db, { ...news('Trump pauses all new tariffs for 90 days', 'Truth Social'), kind: 'social', author: 'Donald Trump' }, 'pending', 0.5);
    await analyzePending(ctx);
    const sent = await flush();
    expect(sent).toHaveLength(1);
    const lines = sent[0]!.split('\n');
    expect(lines[0]).toBe('🚨 HIGH IMPACT | Gold: BEARISH (75%)');
    expect(lines[1]).toBe(HIGH.headline_hinglish);
    expect(lines[2]).toBe(HIGH.explanation);
    expect(lines[3]).toMatch(/^Source: Truth Social \| \d{1,2}:\d{2} (AM|PM)$/);
  });

  it('holds medium items for the digest and drops low/irrelevant ones', async () => {
    const { ctx, analyzer, flush } = makeCtx();
    analyzer.rules.push({ match: /Waller/i, result: MEDIUM });
    recordItem(ctx.db, news('Fed Waller says rate cuts may come sooner than expected'), 'pending', 0.5);
    recordItem(ctx.db, news('Local team wins regional football championship game'), 'pending', 0.5);
    await analyzePending(ctx);
    expect(await flush()).toHaveLength(0);
    expect(sendDigest(ctx)).toBe(1);
    const [digest] = await flush();
    expect(digest).toContain('Gold Digest');
    expect(digest).toContain('🟢 BULLISH (60%)');
    expect(digest).not.toContain('football');
  });

  it('sends one alert when several outlets report the same story', async () => {
    const { ctx, analyzer, flush } = makeCtx();
    analyzer.rules.push({ match: /GDP/i, result: HIGH });
    recordItem(ctx.db, news('Trump demands probe into record setting error after third-quarter GDP revision', 'Reuters', 5), 'pending', 0.5);
    await analyzePending(ctx);
    recordItem(ctx.db, news('Trump demands probe of GDP data released before midterms', 'CNBC', 3), 'pending', 0.5);
    recordItem(ctx.db, news("Trump calls GDP numbers 'fake', demands probe after revision", 'Bloomberg', 1), 'pending', 0.5);
    await analyzePending(ctx);
    const sent = await flush();
    expect(sent).toHaveLength(1);
    const row = ctx.db.prepare("SELECT also_sources FROM seen_items WHERE source = 'Reuters'").get() as { also_sources: string };
    expect(row.also_sources.split(',').sort()).toEqual(['Bloomberg', 'CNBC']);
  });

  it('while muted, high items wait and come back as a catch-up digest on unmute', async () => {
    const { ctx, analyzer, flush } = makeCtx();
    analyzer.rules.push({ match: /missile/i, result: { ...HIGH, gold_bias: 'bullish', headline_hinglish: 'Iran ne Israel pe missiles chhodi.' } });
    const muteReply = handleCommand(ctx, 'mute 1h');
    expect(muteReply).toContain('Muted');
    ctx.outbox.enqueue('command', muteReply);
    recordItem(ctx.db, news('Iran launches ballistic missiles at Israeli bases'), 'pending', 0.5);
    await analyzePending(ctx);
    const duringMute = await flush();
    expect(duringMute).toHaveLength(1); // only the "Muted till ..." reply
    const reply = handleCommand(ctx, 'unmute');
    ctx.outbox.enqueue('command', reply);
    const after = await flush();
    expect(after.some((m) => m.includes('Catch-up') && m.includes('🚨') && m.includes('Iran ne Israel'))).toBe(true);
  });

  it('keeps items pending when Claude is unreachable, instead of losing them', async () => {
    const { ctx, analyzer } = makeCtx();
    analyzer.analyzeBatch = async () => {
      throw new Error('Could not resolve authentication method');
    };
    recordItem(ctx.db, news('Fed Chair signals surprise rate hike next month'), 'pending', 0.5);
    for (let i = 0; i < 5; i++) await analyzePending(ctx);
    const row = ctx.db.prepare('SELECT status FROM seen_items').get() as { status: string };
    expect(row.status).toBe('pending');
    expect(ctx.state.lastAnalysisError).toBe('ANTHROPIC_API_KEY is not set in .env');
  });
});

describe('outbox', () => {
  it('sends at most one message per interval and waits while disconnected', async () => {
    const { ctx, sender } = makeCtx();
    const { Outbox } = await import('../src/delivery/outbox.js');
    const ob = new Outbox(ctx.db, sender, 5_000, () => false);
    ob.enqueue('alert', 'one');
    ob.enqueue('alert', 'two');
    sender.ready = false;
    await ob.tick(Date.now());
    expect(sender.sent).toHaveLength(0);
    sender.ready = true;
    await ob.tick(Date.now() + 10_000);
    await ob.tick(Date.now() + 10_001); // too soon after the previous send
    expect(sender.sent).toEqual(['one']);
    await ob.tick(Date.now() + 20_000);
    expect(sender.sent).toEqual(['one', 'two']);
  });

  it('drops expired messages (e.g. a reminder for an event that already happened)', async () => {
    const { ctx, flush } = makeCtx();
    ctx.outbox.enqueue('reminder', 'old reminder', { expiresAt: Date.now() - 1 });
    ctx.outbox.enqueue('alert', 'fresh');
    expect(await flush()).toEqual(['fresh']);
  });

  it('command replies still go out while muted', async () => {
    const { ctx, flush } = makeCtx();
    setMute(ctx.db, Date.now() + 3_600_000);
    ctx.outbox.enqueue('digest', 'digest text');
    ctx.outbox.enqueue('command', 'status reply');
    expect(await flush()).toEqual(['status reply']);
  });
});
