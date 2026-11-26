import Parser from 'rss-parser';
import type { FeedConfig } from '../config/files.js';
import { httpGet, stripHtml } from '../util/http.js';
import type { NewsItem, NewsSource } from './types.js';

type CustomItem = { 'dc:creator'?: string; description?: string };
const parser: Parser<Record<string, unknown>, CustomItem> = new Parser({ customFields: { item: ['dc:creator', 'description'] } });

/** Google News titles look like "Gold rises as dollar slips - Reuters"; drop the trailing outlet. */
export function cleanTitle(title: string, source: string): string {
  let t = stripHtml(title).replace(/\s+/g, ' ').trim();
  const esc = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The outlet's own name is always dropped; any other short trailing " - Outlet" only on longer titles.
  t = t.replace(new RegExp(`\\s+[-–|]\\s+${esc}(\\s+\\w+)?$`, 'i'), '');
  const other = /\s+[-–|]\s+[A-Z][\w.&' ]{1,40}$/;
  if (other.test(t) && t.replace(other, '').length > 25) t = t.replace(other, '');
  return t;
}

const wordCount = (s: string) => s.split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w)).length;

export async function parseFeed(xml: string, source: string, kind: NewsItem['kind'] = 'news', author?: string): Promise<NewsItem[]> {
  const feed = await parser.parseString(xml);
  const items: NewsItem[] = [];
  for (const it of feed.items) {
    const rawTitle = it.title ?? '';
    if (!rawTitle.trim()) continue;
    // Section/landing pages ("COMMODITIES News", "Videos") that Google News sometimes returns are not headlines.
    if (kind === 'news' && wordCount(cleanTitle(rawTitle, source)) < 4) continue;
    const date = it.isoDate ? new Date(it.isoDate) : it.pubDate ? new Date(it.pubDate) : new Date();
    const summaryRaw = it.contentSnippet ?? it.content ?? it.description ?? '';
    const summary = stripHtml(summaryRaw).slice(0, 600);
    items.push({
      source,
      title: cleanTitle(rawTitle, source),
      url: it.link,
      summary: summary && !summary.startsWith(rawTitle.slice(0, 30)) ? summary : undefined,
      publishedAt: Number.isNaN(date.getTime()) ? new Date() : date,
      kind,
      author: author ?? it['dc:creator'] ?? it.creator,
    });
  }
  return items;
}

function matchesFilter(item: NewsItem, filter?: string[]): boolean {
  if (!filter || filter.length === 0) return true;
  const hay = `${item.title} ${item.summary ?? ''}`.toLowerCase();
  return filter.some((w) => hay.includes(w.toLowerCase()));
}

export function rssSource(feed: FeedConfig): NewsSource {
  return {
    name: `rss:${feed.id}`,
    async fetch() {
      const xml = await httpGet(feed.url, { timeoutMs: 20_000 });
      const items = await parseFeed(xml, feed.source);
      return items.filter((i) => matchesFilter(i, feed.filter));
    },
  };
}
