import os
import tempfile
import unittest
from datetime import datetime, timezone

from bot.news import NewsCalendar, parse
from tests.test_learning import make_engine

T = datetime(2026, 11, 6, 13, 30, tzinfo=timezone.utc).timestamp()   # 08:30 New York
FEED = [
    {"title": "Non-Farm Employment Change", "country": "USD", "date": "2026-11-06T08:30:00-05:00",
     "impact": "High", "forecast": "120K", "previous": "98K"},
    {"title": "Retail Sales m/m", "country": "CAD", "date": "2026-11-06T08:30:00-05:00", "impact": "Medium"},
    {"title": "Bank Holiday", "country": "JPY", "date": "2026-11-03T00:00:00-05:00", "impact": "Holiday"},
    {"title": "broken", "country": "EUR", "date": "not a date", "impact": "High"},
]


class News(unittest.TestCase):
    def test_parse(self):
        ev = parse(FEED)
        self.assertEqual(len(ev), 3)
        nfp = [e for e in ev if e["currency"] == "USD"][0]
        self.assertEqual(nfp["time"], T)
        self.assertEqual(nfp["forecast"], "120K")

    def test_blocks_only_that_currency_in_window(self):
        n = NewsCalendar({}, clock=lambda: T, fetcher=lambda: FEED)
        n.refresh(force=True)
        self.assertIsNotNone(n.blocking("XAU_USD", T - 10 * 60))
        self.assertIsNotNone(n.blocking("EUR_USD", T + 14 * 60))
        self.assertIsNone(n.blocking("EUR_USD", T - 20 * 60))
        self.assertIsNone(n.blocking("EUR_GBP", T))
        self.assertIsNone(n.blocking("USD_CAD", T + 16 * 60))  # CAD medium does not block

    def test_feed_failure_keeps_cache_and_does_not_block(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "n.json")
            n = NewsCalendar({}, p, clock=lambda: T, fetcher=lambda: FEED)
            n.refresh(force=True)

            def boom():
                raise OSError("down")
            m = NewsCalendar({}, p, clock=lambda: T + 7200, fetcher=boom)
            m.refresh(force=True)
            self.assertEqual(m.error, "down")
            self.assertEqual(len(m.events), 3)                 # cache kept
            dead = NewsCalendar({}, None, clock=lambda: T, fetcher=boom)
            dead.refresh(force=True)
            self.assertIsNone(dead.blocking("EUR_USD", T))     # no data -> no block

    def test_refresh_rate_limited(self):
        calls = []
        now = [T]
        n = NewsCalendar({"refresh_minutes": 60}, clock=lambda: now[0], fetcher=lambda: calls.append(1) or FEED)
        n.refresh(); n.refresh()
        now[0] += 3601
        n.refresh()
        self.assertEqual(len(calls), 2)


class EngineNews(unittest.TestCase):
    def test_news_blocks_signal_and_reports(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, clock = make_engine(d)
            feed = [{"title": "CPI m/m", "country": "USD", "impact": "High",
                     "date": datetime.fromtimestamp(clock[0] + 300, timezone.utc).isoformat()}]
            e.news.p["enabled"] = True
            e.news.fetcher = lambda: feed
            e.tick()
            self.assertEqual(b.orders, [])
            j = e.snapshot()["journeys"][0]
            blocked = [s for s in j["steps"] if s["verdict"] == "block"][0]
            self.assertEqual(blocked["agent"], "timer")
            self.assertIn("Bada news", blocked["text"])
            snap = e.snapshot()
            self.assertTrue(snap["news"][0]["active"])
            self.assertIn("XAU_USD", snap["news"][0]["pairs"])
            news_agent = [a for a in snap["agents"] if a["id"] == "news"][0]
            self.assertIn("BLOCK", news_agent["status"])
            self.assertEqual(news_agent["handoffs"]["timer"], 1)


if __name__ == "__main__":
    unittest.main()
