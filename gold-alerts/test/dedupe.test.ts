import { describe, expect, it } from 'vitest';
import { normalizeTitle, similarity, canonicalUrl, recordItem } from '../src/analysis/dedupe.js';
import { openDb } from '../src/storage/db.js';
import type { NewsItem } from '../src/sources/types.js';

const item = (title: string, source = 'Reuters', url?: string): NewsItem => ({
  title,
  source,
  url: url ?? `https://example.com/${encodeURIComponent(title)}`,
  publishedAt: new Date(),
  kind: 'news',
});

describe('similarity', () => {
  it('matches the same story worded differently by two outlets', () => {
    const a = normalizeTitle('Fed holds rates steady, signals patience on cuts');
    const b = normalizeTitle('Federal Reserve: Fed holds rates steady and signals patience');
    expect(similarity(a, b)).toBeGreaterThan(0.55);
  });

  it('keeps different stories apart', () => {
    const a = normalizeTitle('Gold rises as dollar slips after weak jobs data');
    const b = normalizeTitle('Oil falls as OPEC+ agrees to raise output');
    expect(similarity(a, b)).toBeLessThan(0.3);
  });

  it('does not merge two different CPI prints', () => {
    const a = normalizeTitle('US CPI rises 0.4% in October, above forecast');
    const b = normalizeTitle('Canada CPI rises 0.1% in October, below forecast');
    expect(similarity(a, b)).toBeLessThan(0.75);
  });
});

describe('canonicalUrl', () => {
  it('drops tracking params and www', () => {
    expect(canonicalUrl('https://www.reuters.com/markets/x/?utm_source=rss&id=5#top')).toBe('reuters.com/markets/x?id=5');
  });
});

describe('recordItem', () => {
  it('stores a story once and remembers which other outlets ran it', () => {
    const db = openDb('/tmp', ':memory:');
    const first = recordItem(db, item('Iran fires missiles at Israel, oil jumps 5%'), 'pending', 0.55);
    expect(first.isNew).toBe(true);
    const again = recordItem(db, item('Iran fires missiles at Israel, oil jumps 5%'), 'pending', 0.55);
    expect(again.isNew).toBe(false);
    const other = recordItem(db, item('Iran fires missiles at Israel as oil jumps 5 percent - AP', 'AP'), 'pending', 0.55);
    expect(other.isNew).toBe(false);
    expect(other.id).toBe(first.id);
    const row = db.prepare('SELECT also_sources FROM seen_items WHERE id = ?').get(first.id) as { also_sources: string };
    expect(row.also_sources).toBe('AP');
    const different = recordItem(db, item('ECB keeps rates unchanged, Lagarde cautious'), 'pending', 0.55);
    expect(different.isNew).toBe(true);
  });
});
