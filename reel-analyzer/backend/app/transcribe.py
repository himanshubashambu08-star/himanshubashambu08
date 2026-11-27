"""Speech to text with OpenAI Whisper."""
from pathlib import Path

from .config import WHISPER_MODEL, env
from .media import UserFacingError

# UI choice -> (Whisper language code or None for auto-detect, prompt hint)
LANGUAGES = {
    "auto": (None, "The speaker may use Hindi, Punjabi, English or a mix (Hinglish)."),
    "en": ("en", ""),
    "hi": ("hi", "यह वीडियो हिंदी में है।"),
    "pa": ("pa", "ਇਹ ਵੀਡੀਓ ਪੰਜਾਬੀ ਵਿੱਚ ਹੈ।"),
    # Hinglish: let Whisper keep English words in Latin script instead of forcing Devanagari
    "hinglish": (None, "Haan bhai, aaj hum dekhenge ki yeh business kaise chalta hai. Mixed Hindi and English, written in Roman script."),
}


def _fmt(t: float) -> str:
    return f"{int(t // 60)}:{int(t % 60):02d}"


def transcribe(audio: Path, language: str = "auto") -> dict:
    if not env("OPENAI_API_KEY"):
        raise UserFacingError("OPENAI_API_KEY is not set on the server, so the audio can't be transcribed.")
    from openai import OpenAI, APIConnectionError, APIStatusError, AuthenticationError

    lang, hint = LANGUAGES.get(language, LANGUAGES["auto"])
    client = OpenAI()
    kwargs = {"model": WHISPER_MODEL, "file": audio.open("rb")}
    if WHISPER_MODEL == "whisper-1":
        kwargs["response_format"] = "verbose_json"
    else:  # gpt-4o-transcribe family only returns json/text
        kwargs["response_format"] = "json"
    if lang:
        kwargs["language"] = lang
    if hint:
        kwargs["prompt"] = hint
    try:
        res = client.audio.transcriptions.create(**kwargs)
    except AuthenticationError as e:
        raise UserFacingError("The OpenAI API key was rejected. Check OPENAI_API_KEY.") from e
    except APIConnectionError as e:
        raise UserFacingError("Couldn't reach OpenAI to transcribe the audio. Try again in a minute.") from e
    except APIStatusError as e:
        raise UserFacingError(f"Transcription failed (OpenAI said: {e.message[:200]}).") from e
    finally:
        kwargs["file"].close()

    segments = getattr(res, "segments", None) or []
    if segments:
        timed = "\n".join(f"[{_fmt(s.start)}] {s.text.strip()}" for s in segments if s.text.strip())
    else:
        timed = (res.text or "").strip()
    return {
        "text": (res.text or "").strip(),
        "timed": timed,
        "language": getattr(res, "language", None) or lang or "",
    }
