"""Claude vision analysis of frames + transcript, and follow-up chat."""
import base64
import json
from pathlib import Path
from typing import Callable, Iterator

from .config import CLAUDE_MODEL, env
from .media import UserFacingError

BETAS = ["server-side-fallback-2026-07-01"]


def _client():
    if not env("ANTHROPIC_API_KEY") and not env("ANTHROPIC_AUTH_TOKEN"):
        raise UserFacingError("ANTHROPIC_API_KEY is not set on the server, so the video can't be analyzed.")
    import anthropic

    return anthropic.Anthropic()


def _obj(props: dict) -> dict:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


S = {"type": "string"}
LIST_S = {"type": "array", "items": S}

ANALYSIS_SCHEMA = _obj({
    "title": S,
    "tags": LIST_S,
    "language": S,
    "on_screen_text": LIST_S,
    "scenes": {"type": "array", "items": _obj({"time": S, "description": S})},
    "hook": _obj({
        "hook_line": S,
        "main_message": S,
        "why_it_works": LIST_S,
        "attention_grabbers": LIST_S,
        "target_audience": S,
    }),
    "concept": _obj({
        "summary": S,
        "category": S,
        "product_or_service": S,
        "how_it_makes_money": LIST_S,
    }),
    "how_to": _obj({
        "steps": LIST_S,
        "tools": LIST_S,
        "skills": LIST_S,
        "cost_estimate": _obj({"currency": S, "low": {"type": "number"}, "high": {"type": "number"}, "breakdown": LIST_S, "notes": S}),
        "time_to_start": S,
    }),
    "remixes": {"type": "array", "items": _obj({"niche": S, "idea": S, "how_it_maps": S, "first_step": S})},
    "content_ideas": {"type": "array", "items": _obj({
        "title": S,
        "hook": S,
        "script_outline": LIST_S,
        "caption": S,
        "hashtags": LIST_S,
    })},
})

SYSTEM = """You are Reel Analyzer: a sharp short-form video strategist and small-business advisor.
You receive key frames from a short video (Instagram Reel, TikTok or YouTube Short) with their timestamps, plus the audio transcript and any caption the creator posted.
Your reader is an entrepreneur and content creator watching reels for business ideas. Be concrete, practical and specific to THIS video - never generic advice.

Rules:
- Base the scene descriptions on what is actually visible in the frames. If something is uncertain, say so briefly.
- Read all on-screen text (captions, overlays, signs, prices, product labels) from the frames and list it in on_screen_text, in its original language and script. Skip duplicates across frames.
- The transcript may be Hindi, Punjabi, English or Hinglish. Understand it in the original language, but write your analysis in clear, simple English. Quote key lines in their original language where it helps.
- Cost estimates: realistic low/high numbers for starting this as a small operation. Use the currency the user asked for; if "auto", use the currency of the market the video appears to be from.
- remixes: exactly 5, each a different business or niche that reuses the video's core concept (e.g. a dumper truck video -> towing, scrap collection, construction equipment rental, logistics, a content channel). Make each one actionable.
- content_ideas: exactly 3 original reel ideas the reader could film themselves, each with a scroll-stopping hook (first 1-2 seconds), a 4-7 beat script outline, a ready-to-post caption and 5-10 hashtags.
- tags: 3-8 short lowercase tags (niche, industry, format) for searching a library later.
- title: a short descriptive title (max ~8 words) for the library."""


def _image_block(path: Path) -> dict:
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.standard_b64encode(path.read_bytes()).decode()},
    }


def _fmt(t: float) -> str:
    return f"{int(t // 60)}:{int(t % 60):02d}"


def _frame_content(frames_dir: Path, frames: list[dict], limit: int | None = None) -> list[dict]:
    chosen = frames
    if limit and len(frames) > limit:
        step = len(frames) / limit
        chosen = [frames[int(i * step)] for i in range(limit)]
    content: list[dict] = []
    for f in chosen:
        content.append({"type": "text", "text": f"Frame at {_fmt(f['t'])}"})
        content.append(_image_block(frames_dir / f["file"]))
    return content


def _context_text(meta: dict, transcript: str, duration: float) -> str:
    parts = [f"Video length: {duration:.0f} seconds. Source: {meta.get('platform') or 'upload'}."]
    if meta.get("title"):
        parts.append(f"Original title: {meta['title']}")
    if meta.get("uploader"):
        parts.append(f"Creator: {meta['uploader']}")
    if meta.get("description"):
        parts.append(f"Creator's caption:\n{meta['description']}")
    parts.append("Transcript (timestamps in m:ss):\n" + (transcript.strip() or "(no speech detected - analyze from visuals only)"))
    return "\n\n".join(parts)


def _final_text(message) -> str:
    """Text produced by the model that finished the turn (after any refusal fallback switch)."""
    blocks = list(message.content)
    last_fb = max((i for i, b in enumerate(blocks) if b.type == "fallback"), default=-1)
    return "".join(b.text for b in blocks[last_fb + 1:] if b.type == "text")


def _api_error(e: Exception) -> UserFacingError:
    import anthropic

    if isinstance(e, anthropic.AuthenticationError):
        return UserFacingError("The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.")
    if isinstance(e, anthropic.RateLimitError):
        return UserFacingError("Claude is rate-limited right now. Wait a minute and try again.")
    if isinstance(e, anthropic.BadRequestError):
        return UserFacingError(f"Claude couldn't process this request: {e.message[:300]}")
    if isinstance(e, anthropic.APIStatusError):
        return UserFacingError(f"Claude API error ({e.status_code}). Try again in a minute.")
    if isinstance(e, anthropic.APIConnectionError):
        return UserFacingError("Couldn't reach the Claude API. Check the server's internet connection.")
    return UserFacingError(str(e))


def analyze(frames_dir: Path, frames: list[dict], transcript: str, meta: dict, duration: float,
            currency: str = "auto", on_progress: Callable[[float], None] | None = None) -> dict:
    import anthropic

    client = _client()
    content = _frame_content(frames_dir, frames)
    content.append({"type": "text", "text": _context_text(meta, transcript, duration)})
    content.append({"type": "text", "text": f"Currency for cost estimates: {currency}.\n\nAnalyze this video and fill in every section."})

    try:
        with client.beta.messages.stream(
            model=CLAUDE_MODEL,
            max_tokens=32000,
            betas=BETAS,
            fallbacks="default",
            system=SYSTEM,
            thinking={"type": "adaptive"},
            output_config={"effort": "high", "format": {"type": "json_schema", "schema": ANALYSIS_SCHEMA}},
            messages=[{"role": "user", "content": content}],
        ) as stream:
            chars = 0
            for event in stream:
                if event.type == "content_block_delta" and getattr(event.delta, "type", "") == "text_delta":
                    chars += len(event.delta.text)
                    if on_progress:
                        on_progress(min(chars / 9000, 1.0))
            final = stream.get_final_message()
    except anthropic.APIError as e:
        raise _api_error(e) from e

    if final.stop_reason == "refusal":
        raise UserFacingError("Claude declined to analyze this video.")
    if final.stop_reason == "max_tokens":
        raise UserFacingError("The analysis was cut off before it finished. Try again.")
    try:
        return json.loads(_final_text(final))
    except json.JSONDecodeError as e:
        raise UserFacingError("Claude returned an analysis we couldn't read. Try again.") from e


CHAT_SYSTEM = """You are Reel Analyzer's follow-up assistant. The user already has your structured analysis of a short video (below) and is asking follow-up questions about the same video.
Answer specifically about this video and the user's business goals. Be practical: numbers, steps, names of tools, scripts, captions. Use short markdown (headings, bullets, bold) suitable for a phone screen.
If the user writes in Hindi, Punjabi or Hinglish, reply in the same style."""


def chat_stream(frames_dir: Path, reel: dict, history: list[dict], question: str) -> Iterator[dict]:
    """Yields {"type": "delta", "text"} events, then one {"type": "final", "text"}."""
    import anthropic

    client = _client()
    meta = {"platform": reel.get("platform"), "title": reel.get("title"), "uploader": reel.get("uploader")}
    context = _frame_content(frames_dir, reel.get("frames") or [], limit=10)
    context.append({"type": "text", "text": _context_text(meta, reel.get("transcript") or "", reel.get("duration") or 0)})
    context.append({"type": "text", "text": "Your earlier analysis (JSON):\n" + json.dumps(reel.get("analysis") or {}, ensure_ascii=False)})

    messages = [
        {"role": "user", "content": context},
        {"role": "assistant", "content": "I've reviewed the video, transcript and my analysis. What would you like to know?"},
    ]
    for m in history[-20:]:
        messages.append({"role": m["role"], "content": m["content"]})
    messages.append({"role": "user", "content": question})

    try:
        with client.beta.messages.stream(
            model=CLAUDE_MODEL,
            max_tokens=16000,
            betas=BETAS,
            fallbacks="default",
            system=CHAT_SYSTEM,
            thinking={"type": "adaptive"},
            output_config={"effort": "medium"},
            cache_control={"type": "ephemeral"},
            messages=messages,
        ) as stream:
            for text in stream.text_stream:
                yield {"type": "delta", "text": text}
            final = stream.get_final_message()
    except anthropic.APIError as e:
        raise _api_error(e) from e

    if final.stop_reason == "refusal":
        raise UserFacingError("Claude declined to answer that question.")
    yield {"type": "final", "text": _final_text(final)}
