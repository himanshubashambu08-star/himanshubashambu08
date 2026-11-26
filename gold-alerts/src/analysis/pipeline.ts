import type { AppContext } from '../context.js';
import { isMuted } from '../context.js';
import { finnhubSource } from '../sources/finnhub.js';
import { runIsolated } from '../sources/health.js';
import { rssSource } from '../sources/rss.js';
import { truthSocialSource, xSource } from '../sources/social.js';
import type { NewsItem, NewsSource } from '../sources/types.js';
import { formatDigest, formatHighAlert, type AlertItem } from '../delivery/format.js';
import { childLogger } from '../util/logger.js';
import { describeApiError, type ItemAnalysis } from './claude.js';
import { recordItem, similarity } from './dedupe.js';

const log = childLogger('pipeline');

const finnhubInstances = new Map<string, NewsSource>();

/** Built fresh each poll so edits to config/*.json apply without a restart. */
export function buildNewsSources(ctx: AppContext): NewsSource[] {
  const { env, cfg } = ctx;
  const sources: NewsSource[] = cfg.feeds().filter((f) => f.enabled).map(rssSource);
  if (env.FINNHUB_API_KEY) {
    for (const cat of ['general', 'forex'] as const) {
      if (!finnhubInstances.has(cat)) finnhubInstances.set(cat, finnhubSource(env.FINNHUB_API_KEY, cat));
      sources.push(finnhubInstances.get(cat)!);
    }
  }
  const social = cfg.social();
  sources.push(...social.truthSocial.filter((a) => a.enabled).map(truthSocialSource));
  if (env.ENABLE_X) sources.push(...social.x.filter((a) => a.enabled).map((a) => xSource(a, env.X_RSS_URL_TEMPLATE)));
  return sources;
}

let polling = false;

/** Fetches every source in parallel (each isolated), stores new items, returns how many are new. */
export async function pollNews(ctx: AppContext): Promise<number> {
  if (polling) return 0;
  polling = true;
  try {
    const sources = buildNewsSources(ctx);
    const results = await Promise.all(sources.map((s) => runIsolated<NewsItem>(ctx.db, s.name, () => s.fetch())));
    const maxAge = ctx.env.MAX_ITEM_AGE_MINUTES * 60_000;
    const now = Date.now();
    let fresh = 0;
    ctx.db.transaction(() => {
      for (const items of results) {
        // Oldest first, so the earliest outlet to report a story "owns" it.
        for (const item of [...items].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())) {
          const tooOld = now - item.publishedAt.getTime() > maxAge;
          const r = recordItem(ctx.db, item, tooOld ? 'skipped' : 'pending', ctx.env.DUPLICATE_SIMILARITY);
          if (r.isNew && !tooOld) fresh++;
        }
      }
    })();
    ctx.state.lastNewsPoll = Date.now();
    ctx.state.lastNewsPollItems = results.reduce((n, r) => n + r.length, 0);
    if (fresh) log.info({ fresh }, 'new items to analyze');
    return fresh;
  } finally {
    polling = false;
  }
}

interface PendingRow {
  id: number;
  title: string;
  summary: string | null;
  source: string;
  kind: string;
  published_at: number;
  attempts: number;
}

const BATCH = 10;

let analyzing = false;

/** Sends pending items to Claude in batches, stores results and routes them (instant / digest / drop). */
export async function analyzePending(ctx: AppContext): Promise<void> {
  if (analyzing) return;
  analyzing = true;
  try {
    // Items still unanalyzed after MAX_ITEM_AGE_MINUTES (e.g. Claude was down) are no longer news; stop retrying them.
    ctx.db
      .prepare("UPDATE seen_items SET status = 'skipped' WHERE status = 'pending' AND published_at < ?")
      .run(Date.now() - ctx.env.MAX_ITEM_AGE_MINUTES * 60_000);
    const rows = ctx.db
      .prepare("SELECT id, title, summary, source, kind, published_at, attempts FROM seen_items WHERE status = 'pending' ORDER BY published_at DESC LIMIT 60")
      .all() as PendingRow[];
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      let results: Map<number, ItemAnalysis>;
      try {
        results = await ctx.analyzer.analyzeBatch(
          batch.map((r, idx) => ({
            index: idx,
            source: r.source.replace('|', ' — '),
            title: r.title,
            summary: r.summary,
            publishedAt: r.published_at,
            kind: r.kind,
          })),
        );
        ctx.state.lastAnalysisOk = Date.now();
        ctx.state.lastAnalysisError = null;
      } catch (err) {
        ctx.state.lastAnalysisError = describeApiError(err);
        log.error({ err: ctx.state.lastAnalysisError }, 'analysis batch failed; will retry next cycle');
        // An API outage/key problem is not the item's fault: keep it pending (it ages out after MAX_ITEM_AGE_MINUTES).
        return;
      }
      const missing: PendingRow[] = [];
      batch.forEach((row, idx) => {
        const a = results.get(idx);
        if (a) route(ctx, row, a);
        else missing.push(row);
      });
      if (missing.length) bumpAttempts(ctx, missing);
    }
  } finally {
    analyzing = false;
  }
}

function bumpAttempts(ctx: AppContext, rows: PendingRow[]) {
  const stmt = ctx.db.prepare("UPDATE seen_items SET attempts = attempts + 1, status = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE status END WHERE id = ?");
  for (const r of rows) stmt.run(r.id);
}

/** Looser than the feed-level dedupe: outlets word the same breaking story very differently. */
const STORY_SIMILARITY = 0.4;
const STORY_WINDOW_MS = 3 * 3_600_000;

/** An item already alerted/queued in the last few hours that tells the same story, if any. */
function sameStoryAs(ctx: AppContext, id: number): number | null {
  const me = ctx.db.prepare('SELECT norm_title FROM seen_items WHERE id = ?').get(id) as { norm_title: string } | undefined;
  if (!me) return null;
  const recent = ctx.db
    .prepare(
      `SELECT s.id, s.norm_title FROM seen_items s JOIN analyses a ON a.item_id = s.id
       WHERE s.id != ? AND a.created_at >= ? AND a.routed IN ('instant', 'digest')`,
    )
    .all(id, Date.now() - STORY_WINDOW_MS) as { id: number; norm_title: string }[];
  let best: { id: number; s: number } | null = null;
  for (const r of recent) {
    const sc = similarity(me.norm_title, r.norm_title);
    if (sc >= STORY_SIMILARITY && (!best || sc > best.s)) best = { id: r.id, s: sc };
  }
  return best?.id ?? null;
}

export type Routing = 'instant' | 'digest' | 'dropped' | 'merged';

export function route(ctx: AppContext, row: { id: number }, a: ItemAnalysis): Routing {
  const relevant = a.relevant && a.impact !== 'low';
  const muted = isMuted(ctx.db);
  let routed: Routing = !relevant ? 'dropped' : a.impact === 'high' && !muted ? 'instant' : 'digest';
  const sameAs = routed === 'dropped' ? null : sameStoryAs(ctx, row.id);
  if (sameAs !== null) routed = 'merged';
  ctx.db.transaction(() => {
    ctx.db
      .prepare(
        `INSERT OR REPLACE INTO analyses(item_id, relevant, impact, gold_bias, confidence, headline, explanation, created_at, routed)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, a.relevant ? 1 : 0, a.impact, a.gold_bias, a.confidence, a.headline_hinglish, a.explanation, Date.now(), routed);
    ctx.db.prepare("UPDATE seen_items SET status = 'analyzed', duplicate_of = ? WHERE id = ?").run(sameAs, row.id);
    if (sameAs !== null) {
      // Credit the extra outlet on the original story instead of alerting twice.
      const src = (ctx.db.prepare('SELECT source FROM seen_items WHERE id = ?').get(row.id) as { source: string }).source;
      const orig = ctx.db.prepare('SELECT source, also_sources FROM seen_items WHERE id = ?').get(sameAs) as { source: string; also_sources: string | null };
      const list = (orig.also_sources ?? '').split(',').filter(Boolean);
      if (src !== orig.source && !list.includes(src)) {
        ctx.db.prepare('UPDATE seen_items SET also_sources = ? WHERE id = ?').run([...list, src].join(','), sameAs);
      }
      // A later, higher-impact report of a story that was only queued for the digest gets promoted.
      const origA = ctx.db.prepare('SELECT routed FROM analyses WHERE item_id = ?').get(sameAs) as { routed: string };
      if (origA.routed === 'digest' && a.impact === 'high' && !muted) {
        ctx.db.prepare('DELETE FROM digest_queue WHERE item_id = ?').run(sameAs);
        ctx.db.prepare("UPDATE analyses SET routed = 'merged' WHERE item_id = ?").run(sameAs);
        ctx.db.prepare("UPDATE analyses SET routed = 'instant' WHERE item_id = ?").run(row.id);
        routed = 'instant';
      }
    }
    if (routed === 'digest') {
      ctx.db
        .prepare('INSERT OR IGNORE INTO digest_queue(item_id, reason, created_at) VALUES(?, ?, ?)')
        .run(row.id, a.impact === 'high' ? 'muted-high' : 'medium', Date.now());
    }
  })();
  if (routed === 'instant') {
    const item = loadAlertItem(ctx, row.id);
    if (item) {
      ctx.outbox.enqueue('alert', formatHighAlert(item));
      log.info({ id: row.id, bias: a.gold_bias, conf: a.confidence }, 'HIGH impact alert queued');
    }
  } else if (routed === 'merged') {
    log.debug({ id: row.id, sameAs }, 'same story as an earlier item; not sent again');
  }
  return routed;
}

interface JoinedRow {
  id: number;
  title: string;
  source: string;
  also_sources: string | null;
  published_at: number;
  impact: ItemAnalysis['impact'];
  gold_bias: ItemAnalysis['gold_bias'];
  confidence: number;
  headline: string;
  explanation: string;
}

const JOIN = `SELECT s.id, s.title, s.source, s.also_sources, s.published_at, a.impact, a.gold_bias, a.confidence, a.headline, a.explanation
  FROM seen_items s JOIN analyses a ON a.item_id = s.id`;

function toAlertItem(r: JoinedRow): AlertItem {
  return {
    title: r.title,
    source: r.source,
    alsoSources: r.also_sources,
    publishedAt: r.published_at,
    analysis: { impact: r.impact, gold_bias: r.gold_bias, confidence: r.confidence, headline_hinglish: r.headline, explanation: r.explanation },
  };
}

export function loadAlertItem(ctx: AppContext, id: number): AlertItem | null {
  const r = ctx.db.prepare(`${JOIN} WHERE s.id = ?`).get(id) as JoinedRow | undefined;
  return r ? toAlertItem(r) : null;
}

/** Items waiting for the digest: held highs (from mute) first, then by confidence. */
export function digestCandidates(ctx: AppContext): { items: AlertItem[]; ids: number[] } {
  const rows = ctx.db
    .prepare(
      `${JOIN} JOIN digest_queue q ON q.item_id = s.id
       ORDER BY CASE a.impact WHEN 'high' THEN 0 ELSE 1 END, a.confidence DESC, s.published_at DESC`,
    )
    .all() as JoinedRow[];
  return { items: rows.map(toAlertItem), ids: rows.map((r) => r.id) };
}

const DIGEST_MAX = 8;

/** Sends the medium-impact digest. Returns number of items sent. */
export function sendDigest(ctx: AppContext, opts: { title?: string } = {}): number {
  const { items, ids } = digestCandidates(ctx);
  if (items.length === 0) return 0;
  const take = items.slice(0, DIGEST_MAX);
  const takeIds = ids.slice(0, DIGEST_MAX);
  ctx.outbox.enqueue('digest', formatDigest(take, { title: opts.title, more: items.length - take.length }));
  const del = ctx.db.prepare('DELETE FROM digest_queue WHERE item_id = ?');
  ctx.db.transaction(() => takeIds.forEach((id) => del.run(id)))();
  return take.length;
}

/** Top analyzed relevant items since `sinceMs` (for the morning briefing). */
export function topHeadlinesSince(ctx: AppContext, sinceMs: number, limit: number): { items: AlertItem[]; total: number } {
  const rows = ctx.db
    .prepare(
      `${JOIN} WHERE s.published_at >= ? AND a.relevant = 1 AND a.impact IN ('high','medium')
       ORDER BY CASE a.impact WHEN 'high' THEN 0 ELSE 1 END, a.confidence DESC`,
    )
    .all(sinceMs) as JoinedRow[];
  return { items: rows.slice(0, limit).map(toAlertItem), total: rows.length };
}
