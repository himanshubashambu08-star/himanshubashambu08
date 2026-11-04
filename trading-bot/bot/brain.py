"""The Manager robot's brain: Claude with live web search, plus a daily world-market brief.

Needs the `anthropic` package and ANTHROPIC_API_KEY (see deploy/enable-brain.sh). Without them the
rest of the bot runs normally and the chat tab says how to switch the brain on.

The brain can READ everything the bot knows (agents, trades, news, lessons) and search/read the web.
It cannot place trades or change settings: answers only.
"""
import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

log = logging.getLogger("bot")
NY = ZoneInfo("America/New_York")

DEFAULTS = {
    "enabled": True,
    "model": "claude-opus-5-5",
    "effort": "medium",
    "max_searches": 5,
    "brief_times_ny": ["07:30", "16:30"],   # world-market brief, Mon-Fri
    "max_history": 12,
}

SYSTEM = """Tum "Manager" ho: ek forex trading bot ke dashboard ka robot assistant. User Canada (London, Ontario) mein rehta hai \
aur Hinglish (Roman Hindi + English) mein baat karta hai; tum bhi simple Hinglish mein jawab do, chhote paragraphs aur bullets mein.

Har sawaal ke saath tumhe bot ka taaza data milega (BOT DATA). Bot OANDA demo account pe forex trade karta hai, sirf New York session \
(08:00-16:00 NY) mein naye trades leta hai, aur 10 agents mein bata hai (Chart Scanner, Chart Reader, Rule Checker, Entry Timer, \
Risk Manager, Order Executor, Exit Planner, Time Machine, News Monitor, Budget Manager).

Kaam:
- Bot ke baare mein sawaal: sirf BOT DATA se jawab do. Data mein nahi hai to saaf bolo.
- Market, news, duniya, ya koi bhi latest cheez: web_search se taaza jaankari lo, aur jawab ke end mein sources do.
- Forex pe asar batate waqt saaf bolo kis currency ke liye achi khabar hai aur kiske liye buri, aur yeh tendency hai, guarantee nahi.
- Tum trade place nahi kar sakte aur settings nahi badal sakte. User kahe to batao ki woh Termius/config se kaise karega.
- Paisa lagane ki pakki salaah ya profit ka vaada kabhi mat do. Real money se pehle demo results dekhne ko yaad dilao jab relevant ho.
- Time hamesha New York ka likho (NY)."""

BRIEF_ASK = """Abhi ka world-market brief banao (web_search use karo, aaj aur kal ki khabrein):
1. Forex aur macro ki 3-5 sabse badi khabrein (central banks, inflation/jobs data, geopolitics, oil/gold, risk mood).
2. Har khabar ke saath: kis currency ke liye ACHI (↑) aur kiske liye BURI (↓), ek line mein kyun.
3. Aaj/kal ke bade economic events (NY time).
4. Bot ke pairs ke liye ek line ka nichod.
Bilkul chhota rakho (max ~180 words), Hinglish mein, sources end mein."""


def _now_ny(ts):
    return datetime.fromtimestamp(ts, timezone.utc).astimezone(NY)


class Brain:
    def __init__(self, params=None, context_fn=None, store_path=None, clock=time.time, client=None):
        self.p = {**DEFAULTS, **(params or {})}
        self.context_fn = context_fn or (lambda: {})
        self.store_path, self.clock = store_path, clock
        self.lock = threading.Lock()
        self.briefs = []           # newest first
        self.busy = False
        self._client = client
        self.reason = None
        if store_path and os.path.exists(store_path):
            try:
                with open(store_path) as f:
                    self.briefs = json.load(f).get("briefs", [])
            except Exception:
                pass

    # ---- availability ----------------------------------------------------
    def client(self):
        if self._client is not None:
            return self._client
        if not self.p["enabled"]:
            self.reason = "brain band hai (config: brain.enabled = false)"
            return None
        try:
            import anthropic
        except ImportError:
            self.reason = "anthropic package install nahi hai"
            return None
        if not os.environ.get("ANTHROPIC_API_KEY"):
            self.reason = "ANTHROPIC_API_KEY set nahi hai"
            return None
        self._client = anthropic.Anthropic()
        self.reason = None
        return self._client

    @property
    def available(self):
        return self.client() is not None

    # ---- one Claude call with web search ------------------------------------
    def _call(self, messages):
        c = self.client()
        if c is None:
            raise RuntimeError(self.reason)
        tools = [
            {"type": "web_search_20260209", "name": "web_search", "max_uses": self.p["max_searches"]},
            {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 3},
        ]
        msgs = list(messages)
        resp = None
        for _ in range(4):                       # resume server-tool turns that pause
            resp = c.beta.messages.create(
                model=self.p["model"], max_tokens=16000, system=SYSTEM, messages=msgs, tools=tools,
                output_config={"effort": self.p["effort"]},
                betas=["server-side-fallback-2026-07-01"], fallbacks="default",
            )
            if resp.stop_reason != "pause_turn":
                break
            msgs = msgs + [{"role": "assistant", "content": resp.content}]
        if resp.stop_reason == "refusal":
            return {"text": "Maaf karna, is sawaal ka jawab main nahi de sakta. Kuch aur poochho.", "sources": []}
        text, sources, seen = [], [], set()
        for b in resp.content:
            if b.type == "text":
                text.append(b.text)
                for cit in getattr(b, "citations", None) or []:
                    url = getattr(cit, "url", None)
                    if url and url not in seen:
                        seen.add(url)
                        sources.append({"url": url, "title": getattr(cit, "title", None) or url})
            elif b.type == "web_search_tool_result" and isinstance(b.content, list):
                for r in b.content[:3]:
                    url = getattr(r, "url", None)
                    if url and url not in seen and len(sources) < 8:
                        seen.add(url)
                        sources.append({"url": url, "title": getattr(r, "title", None) or url})
        out = "".join(text).strip() or "Jawab khaali aaya, dobara poochho."
        if resp.stop_reason == "max_tokens":
            out += "\n\n(Jawab lamba tha, beech mein kat gaya.)"
        return {"text": out, "sources": sources[:8]}

    def _with_data(self, question):
        data = json.dumps(self.context_fn(), default=str, separators=(",", ":"))
        stamp = _now_ny(self.clock()).strftime("%a %d %b %Y %H:%M")
        return f"Abhi ka time: {stamp} NY\n\nBOT DATA:\n{data}\n\nSAWAAL:\n{question}"

    # ---- chat ----------------------------------------------------------------
    def ask(self, question, history=None):
        question = (question or "").strip()[:2000]
        if not question:
            return {"text": "Kuch poochho to sahi 🙂", "sources": []}
        msgs = []
        for h in (history or [])[-self.p["max_history"]:]:
            role, txt = h.get("role"), str(h.get("text", ""))[:4000]
            if role in ("user", "assistant") and txt and (not msgs or msgs[-1]["role"] != role):
                msgs.append({"role": role, "content": txt})
        if msgs and msgs[0]["role"] != "user":
            msgs = msgs[1:]
        if msgs and msgs[-1]["role"] == "user":
            msgs = msgs[:-1]
        msgs.append({"role": "user", "content": self._with_data(question)})
        try:
            return self._call(msgs)
        except Exception as e:
            log.error("brain ask failed: %s", e)
            return {"text": f"Abhi jawab nahi de paya: {e}", "sources": [], "error": True}

    # ---- daily world brief -----------------------------------------------------
    def due_brief(self, now):
        ny = _now_ny(now)
        if ny.weekday() >= 5:
            return None
        hm, day = ny.strftime("%H:%M"), ny.strftime("%Y-%m-%d")
        for t in self.p["brief_times_ny"]:
            slot = f"{day} {t}"
            if hm >= t and not any(b.get("slot") == slot for b in self.briefs) and hm < _plus(t, 120):
                return slot
        return None

    def maybe_brief(self, now, on_done=None):
        if self.busy or not self.available:
            return False
        slot = self.due_brief(now)
        if not slot:
            return False
        self.busy = True

        def work():
            try:
                res = self._call([{"role": "user", "content": self._with_data(BRIEF_ASK)}])
                b = {"slot": slot, "time": self.clock(), **res}
                with self.lock:
                    self.briefs = ([b] + self.briefs)[:20]
                    self._save()
                if on_done:
                    on_done(b)
            except Exception as e:
                log.error("brief failed: %s", e)
            finally:
                self.busy = False
        threading.Thread(target=work, daemon=True).start()
        return True

    def _save(self):
        if not self.store_path:
            return
        tmp = self.store_path + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"briefs": self.briefs}, f)
        os.replace(tmp, self.store_path)

    def snapshot(self):
        self.client()
        return {"available": self._client is not None, "reason": self.reason, "model": self.p["model"],
                "briefs": self.briefs[:5], "busy": self.busy}


def _plus(hm, minutes):
    h, m = map(int, hm.split(":"))
    t = h * 60 + m + minutes
    return f"{min(t // 60, 23):02d}:{t % 60 if t // 60 < 24 else 59:02d}"
