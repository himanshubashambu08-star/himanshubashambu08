import crypto from 'node:crypto';
import type { DB } from '../storage/db.js';
import type { NewsItem } from '../sources/types.js';

const STOPWORDS = new Set(
  'a an the and or but of to in on at for from by with as is are was were be been it its this that these those after before over under amid into than says said say report reports update live latest news via new us u.s'.split(
    ' ',
  ),
);

/** Lowercase, drop punctuation/stopwords, light stemming, so "Gold rises as Fed..." ~ "Gold rose after the Fed...". */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’`]s\b/g, '')
    .replace(/[^\p{L}\p{N}%$.\s]/gu, ' ')
    .replace(/(\d)\.(\d)/g, '$1_$2') // keep 4.3 together
    .replace(/\./g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .map(stem)
    .join(' ');
}

function stem(w: string): string {
  if (w.length <= 4) return w;
  return w.replace(/(ing|ed|es|s)$/, '');
}

export function tokens(norm: string): Set<string> {
  return new Set(norm.split(' ').filter(Boolean));
}

/**
 * Overlap coefficient blended with Jaccard: robust when one outlet's headline
 * is a shorter version of another's ("Fed holds rates" vs "Fed holds rates steady, signals patience").
 */
export function similarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const jaccard = inter / (A.size + B.size - inter);
  const overlap = inter / Math.min(A.size, B.size);
  // Very short titles can overlap by chance; require some absolute agreement.
  if (inter < 3) return jaccard;
  return 0.5 * jaccard + 0.5 * overlap;
}

export function canonicalUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|cmpid|ref|src|taid|mod)/i.test(p)) u.searchParams.delete(p);
    u.hash = '';
    return `${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}${u.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);

export interface DedupeResult {
  duplicateOf: number | null;
  reason?: 'url' | 'title' | 'similar';
  score?: number;
}

/**
 * Checks an item against everything seen in the last `windowHours`:
 * exact URL hash, exact normalized-title hash, then fuzzy similarity.
 */
export function findDuplicate(db: DB, item: NewsItem, threshold: number, windowHours = 36): DedupeResult {
  const urlHash = sha(canonicalUrl(item.url) || `notitle:${item.title}`);
  const norm = normalizeTitle(item.title);
  const titleHash = sha(norm);
  const since = Date.now() - windowHours * 3_600_000;

  const byUrl = db.prepare('SELECT id FROM seen_items WHERE url_hash = ? LIMIT 1').get(urlHash) as { id: number } | undefined;
  if (byUrl) return { duplicateOf: byUrl.id, reason: 'url' };
  const byTitle = db.prepare('SELECT id FROM seen_items WHERE title_hash = ? LIMIT 1').get(titleHash) as { id: number } | undefined;
  if (byTitle) return { duplicateOf: byTitle.id, reason: 'title' };

  const recent = db
    .prepare('SELECT id, norm_title FROM seen_items WHERE first_seen >= ? AND duplicate_of IS NULL AND kind = ? ORDER BY id DESC LIMIT 3000')
    .all(since, item.kind) as { id: number; norm_title: string }[];
  let best: { id: number; score: number } | null = null;
  for (const r of recent) {
    const s = similarity(norm, r.norm_title);
    if (s >= threshold && (!best || s > best.score)) best = { id: r.id, score: s };
  }
  if (best) return { duplicateOf: best.id, reason: 'similar', score: best.score };
  return { duplicateOf: null };
}

/** Records an item. Returns its row id and whether it is new (not a duplicate). */
export function recordItem(
  db: DB,
  item: NewsItem,
  status: 'pending' | 'skipped',
  threshold: number,
): { id: number; isNew: boolean; dup: DedupeResult } {
  const dup = findDuplicate(db, item, threshold);
  if (dup.duplicateOf !== null) {
    // Exact repeats of the same URL/title from the same feed are just re-polls; ignore silently.
    if (dup.reason !== 'url') {
      const row = db.prepare('SELECT source, also_sources FROM seen_items WHERE id = ?').get(dup.duplicateOf) as
        | { source: string; also_sources: string | null }
        | undefined;
      if (row && row.source !== item.source && !(row.also_sources ?? '').split(',').includes(item.source)) {
        const also = [row.also_sources, item.source].filter(Boolean).join(',');
        db.prepare('UPDATE seen_items SET also_sources = ? WHERE id = ?').run(also, dup.duplicateOf);
      }
    }
    return { id: dup.duplicateOf, isNew: false, dup };
  }
  const norm = normalizeTitle(item.title);
  const res = db
    .prepare(
      `INSERT INTO seen_items(url_hash, title_hash, title, norm_title, url, source, kind, summary, published_at, first_seen, status)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sha(canonicalUrl(item.url) || `notitle:${item.title}`),
      sha(norm),
      item.title,
      norm,
      item.url ?? null,
      item.author && item.kind === 'social' ? `${item.source}|${item.author}` : item.source,
      item.kind,
      item.summary ?? null,
      item.publishedAt.getTime(),
      Date.now(),
      status,
    );
  return { id: Number(res.lastInsertRowid), isNew: true, dup };
}
