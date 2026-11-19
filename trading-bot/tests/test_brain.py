import os
import tempfile
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace as NS

from bot.brain import Brain
from tests.test_learning import make_engine


class FakeClient:
    def __init__(self, replies):
        self.replies, self.calls = list(replies), []
        self.beta = NS(messages=NS(create=self.create))

    def create(self, **kw):
        self.calls.append(kw)
        return self.replies.pop(0)


def text(t, url=None):
    cits = [NS(url=url, title="Reuters")] if url else []
    return NS(type="text", text=t, citations=cits)


class BrainTests(unittest.TestCase):
    def test_ask_sends_bot_data_web_search_and_parses_sources(self):
        fc = FakeClient([NS(stop_reason="end_turn", content=[
            NS(type="web_search_tool_result", content=[NS(url="https://a.example", title="A")]),
            text("USD strong hai.", "https://reuters.example/x")])])
        b = Brain({}, lambda: {"open_trades": []}, client=fc)
        out = b.ask("USD kaisa hai?", [{"role": "user", "text": "hi"}, {"role": "assistant", "text": "hello"}])
        self.assertEqual(out["text"], "USD strong hai.")
        self.assertEqual(out["sources"][0]["url"], "https://a.example")
        kw = fc.calls[0]
        self.assertEqual(kw["model"], "claude-opus-5-5")
        self.assertIn("web_search_20260209", [t["type"] for t in kw["tools"]])
        self.assertEqual(kw["fallbacks"], "default")
        self.assertEqual([m["role"] for m in kw["messages"]], ["user", "assistant", "user"])
        self.assertIn("BOT DATA", kw["messages"][-1]["content"])

    def test_pause_turn_is_resumed_and_refusal_handled(self):
        fc = FakeClient([NS(stop_reason="pause_turn", content=[text("…")]),
                         NS(stop_reason="end_turn", content=[text("done")])])
        self.assertEqual(Brain({}, client=fc).ask("x")["text"], "done")
        self.assertEqual(len(fc.calls), 2)
        fc = FakeClient([NS(stop_reason="refusal", content=[])])
        self.assertIn("Maaf", Brain({}, client=fc).ask("x")["text"])

    def test_without_key_it_is_off_but_does_not_crash(self):
        old = os.environ.pop("ANTHROPIC_API_KEY", None)
        try:
            b = Brain({})
            self.assertFalse(b.available)
            self.assertTrue(b.ask("x").get("error"))
        finally:
            if old:
                os.environ["ANTHROPIC_API_KEY"] = old

    def test_brief_schedule(self):
        b = Brain({"brief_times_ny": ["07:30"]})
        tue_0740 = datetime(2026, 11, 3, 12, 40, tzinfo=timezone.utc).timestamp()
        tue_0700 = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc).timestamp()
        sat = datetime(2026, 11, 7, 12, 40, tzinfo=timezone.utc).timestamp()
        self.assertEqual(b.due_brief(tue_0740), "2026-11-03 07:30")
        self.assertIsNone(b.due_brief(tue_0700))
        self.assertIsNone(b.due_brief(sat))
        b.briefs = [{"slot": "2026-11-03 07:30"}]
        self.assertIsNone(b.due_brief(tue_0740))


class EngineMemory(unittest.TestCase):
    def test_seen_keys_persist_and_context_has_bot_data(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, _ = make_engine(d)
            e.seen_path = os.path.join(d, "seen.json")
            e.tick()
            e.mark_seen(["ev:x:1", "ev:x:1", "open:1"])
            self.assertEqual(e.snapshot()["seen"], ["ev:x:1", "open:1"])
            ctx = e.brain_context()
            self.assertIn("agents", ctx)
            self.assertEqual(ctx["signals"][0]["pair"], "XAU_USD")
            import json
            json.dumps(ctx, default=str)


if __name__ == "__main__":
    unittest.main()
