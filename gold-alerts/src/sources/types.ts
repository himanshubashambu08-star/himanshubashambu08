export type ItemKind = 'news' | 'social';

export interface NewsItem {
  /** Display name of the outlet / account, e.g. "Reuters", "Truth Social". */
  source: string;
  title: string;
  url?: string;
  summary?: string;
  publishedAt: Date;
  kind: ItemKind;
  /** For social posts: who posted (e.g. "Donald Trump"). */
  author?: string;
}

export interface NewsSource {
  /** Unique, stable name used for health tracking, e.g. "rss:reuters-gnews". */
  name: string;
  fetch(): Promise<NewsItem[]>;
}
