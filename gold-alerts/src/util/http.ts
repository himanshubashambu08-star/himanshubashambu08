const DEFAULT_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 gold-alerts/1.0';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    bodySnippet: string,
  ) {
    super(`HTTP ${status} from ${new URL(url).host}${bodySnippet ? `: ${bodySnippet}` : ''}`);
  }
}

export async function httpGet(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'user-agent': DEFAULT_UA,
      accept: 'application/rss+xml, application/xml, application/json, text/xml, */*;q=0.8',
      ...opts.headers,
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  const body = await res.text();
  if (!res.ok) {
    const snippet = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    throw new HttpError(res.status, url, snippet);
  }
  return body;
}

export async function httpGetJson<T>(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const body = await httpGet(url, { ...opts, headers: { accept: 'application/json', ...opts.headers } });
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`Expected JSON from ${new URL(url).host}, got: ${body.slice(0, 120)}`);
  }
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}
