import { httpGetJson } from '../util/http.js';
import type { NewsItem, NewsSource } from './types.js';

interface FinnhubNews {
  id: number;
  category: string;
  datetime: number; // unix seconds
  headline: string;
  source: string;
  summary: string;
  url: string;
}

/**
 * Finnhub free tier: /news?category=general|forex (60 calls/min limit; we use 2/min).
 * minId makes each call return only stories newer than the last one we saw.
 */
export function finnhubSource(apiKey: string, category: 'general' | 'forex'): NewsSource {
  let minId = 0;
  return {
    name: `finnhub:${category}`,
    async fetch() {
      const url = `https://finnhub.io/api/v1/news?category=${category}${minId ? `&minId=${minId}` : ''}`;
      // Key goes in a header, not the URL, so it never shows up in logs.
      const data = await httpGetJson<FinnhubNews[] | { error: string }>(url, { headers: { 'X-Finnhub-Token': apiKey } });
      if (!Array.isArray(data)) throw new Error(`Finnhub: ${data.error ?? 'unexpected response'}`);
      for (const n of data) if (n.id > minId) minId = n.id;
      return data
        .filter((n) => n.headline)
        .map<NewsItem>((n) => ({
          source: n.source ? `${n.source} (Finnhub)` : 'Finnhub',
          title: n.headline.trim(),
          url: n.url,
          summary: n.summary?.slice(0, 600) || undefined,
          publishedAt: new Date(n.datetime * 1000),
          kind: 'news',
        }));
    },
  };
}
