import type { SocialAccount } from '../config/files.js';
import { httpGet } from '../util/http.js';
import { parseFeed } from './rss.js';
import type { NewsItem, NewsSource } from './types.js';

/** Media-only posts ("Image post from ...", bare links) carry nothing the AI can judge. */
export function isEmptySocialPost(item: NewsItem): boolean {
  const strip = (s: string) =>
    s
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\bView (image|video)\b/gi, ' ')
      .replace(/\bQuoted [^\n]{0,40}?(?=View|$)/gi, ' ')
      .replace(/^\s*RT:?\s*/i, ' ')
      .replace(/^(image|video|media|link)? ?post from .*$/i, ' ')
      .replace(/^\[?no title\]?$/i, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return strip(item.title).length < 15 && strip(item.summary ?? '').length < 15;
}

/** Turns an RSS item for a post into one whose "title" is the post text itself. */
export function socialItem(item: NewsItem, platform: string, account: SocialAccount): NewsItem {
  const text = (item.summary && item.summary.length > item.title.length ? item.summary : item.title).replace(/\s+/g, ' ').trim();
  return {
    ...item,
    kind: 'social',
    source: platform,
    author: account.name,
    title: text.length > 280 ? `${text.slice(0, 277)}...` : text,
    summary: text.length > 280 ? text.slice(0, 1200) : undefined,
  };
}

/** Donald Trump (and others) on Truth Social, through a public RSS mirror (default: trumpstruth.org). */
export function truthSocialSource(account: SocialAccount): NewsSource {
  return {
    name: `truth:${account.handle}`,
    async fetch() {
      if (!account.rssUrl) throw new Error(`no rssUrl configured for Truth Social @${account.handle}`);
      const xml = await httpGet(account.rssUrl, { timeoutMs: 20_000 });
      const items = await parseFeed(xml, 'Truth Social', 'social', account.name);
      return items.filter((i) => !isEmptySocialPost(i)).map((i) => socialItem(i, 'Truth Social', account));
    },
  };
}

/**
 * X accounts through an RSS bridge (self-hosted Nitter / RSSHub), because the official X API is paid.
 * URL = account.rssUrl, else X_RSS_URL_TEMPLATE with {handle} replaced.
 */
export function xSource(account: SocialAccount, urlTemplate: string | undefined): NewsSource {
  const url = account.rssUrl ?? (urlTemplate ? urlTemplate.replaceAll('{handle}', account.handle) : undefined);
  return {
    name: `x:${account.handle}`,
    async fetch() {
      if (!url) throw new Error(`no rssUrl for @${account.handle} and X_RSS_URL_TEMPLATE is not set`);
      const xml = await httpGet(url, { timeoutMs: 20_000 });
      const items = await parseFeed(xml, `X @${account.handle}`, 'social', account.name);
      return items
        .filter((i) => !isEmptySocialPost(i))
        .filter((i) => !/^RT by @/i.test(i.title)) // skip plain retweets
        .map((i) => socialItem(i, `X @${account.handle}`, account));
    },
  };
}
