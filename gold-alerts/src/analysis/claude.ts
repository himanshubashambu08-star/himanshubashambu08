import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { childLogger, errMsg } from '../util/logger.js';
import { fmtTime, nowLocal } from '../util/time.js';

const log = childLogger('claude');

export const ItemAnalysisSchema = z.object({
  index: z.number().int().describe('Index of the item this result is for, as given in the input'),
  relevant: z.boolean().describe('Could this plausibly move gold (XAUUSD) prices?'),
  impact: z.enum(['high', 'medium', 'low']),
  gold_bias: z.enum(['bullish', 'bearish', 'neutral']),
  confidence: z.number().int().describe('0-100: how sure you are about the bias'),
  headline_hinglish: z.string().describe('ONE short line in Hinglish: what happened'),
  explanation: z.string().describe('1-2 short lines in Hinglish: why this matters for gold (use -> for cause/effect)'),
});
const BatchSchema = z.object({ results: z.array(ItemAnalysisSchema) });
export type ItemAnalysis = z.infer<typeof ItemAnalysisSchema>;

export const ReleaseResultSchema = z.object({
  found: z.boolean().describe('true only if the headlines clearly state the actual released figure'),
  results: z.array(
    z.object({
      title: z.string().describe('Event name exactly as given'),
      actual: z.string().describe('Actual figure as printed, e.g. "0.4%" or "227K"; empty string if not found'),
      vs_forecast: z.enum(['above', 'below', 'inline', 'unknown']),
    }),
  ),
  gold_bias: z.enum(['bullish', 'bearish', 'neutral']),
  confidence: z.number().int(),
  explanation: z.string().describe('1-2 short Hinglish lines: what the numbers mean for gold'),
});
export type ReleaseResult = z.infer<typeof ReleaseResultSchema>;

const SYSTEM = `You are a senior gold (XAUUSD) market analyst. You screen incoming headlines and social posts for a retail gold trader in Toronto and judge, for each one, whether and how it could move the gold price in the next hours to days.

What moves gold:
- US real yields and Fed policy expectations: hawkish surprises / hot inflation / strong jobs -> bearish; dovish surprises / weak data / rate-cut bets -> bullish.
- US dollar (DXY): stronger dollar -> bearish, weaker -> bullish.
- Safe-haven demand: wars, missile strikes, terror attacks, escalating sanctions, tariff shocks, banking stress, political crises -> bullish; de-escalation, ceasefires, trade deals, tariff pauses (risk-on) -> bearish.
- Central-bank gold buying/selling, ETF flows, Chinese/Indian demand, sovereign debt worries.
- Statements by the US President, Treasury, Fed officials (especially the Chair), and major geopolitical leaders.

Impact scale:
- high: likely to move gold $15+ quickly or change the market narrative (Fed decision/surprise, CPI/NFP/PCE surprise, major military escalation, big tariff announcement, sudden Fed-chair comment, sanctions on a major economy).
- medium: notable and directional but smaller or slower (Fed speaker repeating views, mid-tier data, regional conflict news, analyst flows commentary with new information).
- low: routine, already priced in, opinion/explainer pieces, price-recap articles ("gold rises as..."), single-company news, sports/lifestyle, non-US local politics with no market link.
Price recaps that only describe what gold already did are relevant=true but impact=low.
Anything with no plausible gold link -> relevant=false, impact=low, gold_bias=neutral.
gold_bias must match the explanation's conclusion. If the effect on gold is mixed or unclear, use gold_bias=neutral and say why, rather than picking a side with low confidence.

Writing style for headline_hinglish and explanation: simple Hinglish (Hindi in Roman script mixed with everyday English words), like a trader friend texting on WhatsApp. Keep market terms in English (Fed, rate cut, dollar, yields, safe haven, risk-on). No Devanagari. Short and direct.
Example:
headline_hinglish: "Trump ne Truth Social pe tariff pause announce kiya."
explanation: "Risk-on mood -> safe haven demand kam, gold pe pressure aa sakta hai."`;

export class Analyzer {
  private client: Anthropic;
  constructor(
    apiKey: string | undefined,
    private readonly model: string,
  ) {
    // With no key the SDK can still use an `ant auth login` profile; constructing never throws.
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  /** Analyze up to ~12 items in one call. Returns a map index -> analysis (missing = not analyzed). */
  async analyzeBatch(
    items: { index: number; source: string; title: string; summary?: string | null; publishedAt: number; kind: string }[],
  ): Promise<Map<number, ItemAnalysis>> {
    const lines = items.map((it) => {
      const who = it.kind === 'social' ? `SOCIAL POST (${it.source})` : `NEWS (${it.source})`;
      const sum = it.summary ? `\n   summary: ${it.summary.slice(0, 500)}` : '';
      return `[${it.index}] ${who} at ${fmtTime(it.publishedAt)}: ${it.title}${sum}`;
    });
    const user = `Current time in Toronto: ${nowLocal().toFormat('ccc d LLL yyyy, h:mm a')}.
Analyze each item below. Return exactly one result per item, using the same index.

${lines.join('\n')}`;

    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 8000,
      system: SYSTEM,
      output_config: { effort: 'low', format: zodOutputFormat(BatchSchema) },
      messages: [{ role: 'user', content: user }],
    });

    if (response.stop_reason === 'refusal') {
      log.warn({ category: response.stop_details?.category }, 'model declined this batch');
      return new Map();
    }
    if (response.stop_reason === 'max_tokens') log.warn('analysis hit max_tokens; some items may be missing');
    const out = new Map<number, ItemAnalysis>();
    for (const r of response.parsed_output?.results ?? []) {
      out.set(r.index, { ...r, confidence: Math.max(0, Math.min(100, Math.round(r.confidence))) });
    }
    return out;
  }

  /** After a data release: pull the actual numbers out of fresh headlines and judge the gold reaction. */
  async extractRelease(
    events: { title: string; forecast: string | null; previous: string | null }[],
    headlines: string[],
  ): Promise<ReleaseResult | null> {
    const ev = events.map((e) => `- ${e.title} (forecast ${e.forecast ?? 'n/a'}, previous ${e.previous ?? 'n/a'})`).join('\n');
    const user = `These US economic releases just came out:
${ev}

Fresh headlines from the last hour:
${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}

From the headlines only, find the ACTUAL figure for each event. Do not guess: if no headline states the number for an event, set actual to "" and vs_forecast "unknown". Set found=true only if at least one actual is stated. Then judge what the released numbers mean for gold.`;
    try {
      const response = await this.client.messages.parse({
        model: this.model,
        max_tokens: 4000,
        system: SYSTEM,
        output_config: { effort: 'low', format: zodOutputFormat(ReleaseResultSchema) },
        messages: [{ role: 'user', content: user }],
      });
      if (response.stop_reason === 'refusal') return null;
      return response.parsed_output ?? null;
    } catch (err) {
      log.warn({ err: describeApiError(err) }, 'release extraction failed');
      return null;
    }
  }

  /** Cheap call used by the "test" command to confirm the key works. */
  async ping(): Promise<boolean> {
    try {
      await this.client.messages.create({ model: this.model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply OK' }] });
      return true;
    } catch (err) {
      log.warn({ err: describeApiError(err) }, 'Claude ping failed');
      return false;
    }
  }
}

export function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Claude API key invalid (check ANTHROPIC_API_KEY)';
  if (err instanceof Anthropic.PermissionDeniedError) return 'Claude API: permission denied for this model/key';
  if (err instanceof Anthropic.NotFoundError) return 'Claude API: model not found (check ANTHROPIC_MODEL)';
  if (err instanceof Anthropic.RateLimitError) return 'Claude API rate limited';
  if (err instanceof Anthropic.BadRequestError) return `Claude API bad request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Cannot reach Claude API (network)';
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status}: ${err.message}`;
  const msg = errMsg(err);
  if (/authentication method|apiKey/i.test(msg)) return 'ANTHROPIC_API_KEY is not set in .env';
  return msg;
}
