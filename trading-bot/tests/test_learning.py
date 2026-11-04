import json
import os
import tempfile
import unittest
import urllib.request
from datetime import datetime, timezone

from bot import dashboard, strategy
from bot.broker.sim import SimBroker
from bot.engine import Engine
from bot.learner import Learner, tag_mistakes
from bot.models import Candle, Instrument, Signal
from tests.helpers import pullback_setup, trend_candles

XAU = Instrument("XAU_USD", "METAL", display_precision=3, units_precision=0, min_units=1)
NOW = 1_790_000_000


import itertools
_T = itertools.count()


def sig(inst="EUR_USD", side=1, t=None, **features):
    if t is None:
        t = NOW - 3600 * 10 - next(_T) * 60      # every test signal is a different signal
    f = {"hour_ny": 10, "dow": 2, "rsi": 55, "trend_strength": 0.5, "dist_ema_atr": 0.2,
         "body_atr": 0.5, "spread_ratio": 0.02, "entry_ref": 1.1}
    f.update(features)
    return Signal(inst, side, 0.002, 0.0013, "test", time=t, features=f)


def add_done(learner, s, r, bars=5, max_r=0.5):
    rid = learner.record_signal(s, taken=False)
    learner._update(rid, status="done", r=r, bars_held=bars, max_r=max_r,
                    mistakes=json.dumps(tag_mistakes({"instrument": s.instrument, "side": s.side,
                                                      "features": s.features}, r, bars, max_r)))


class Mistakes(unittest.TestCase):
    def test_tags(self):
        row = {"instrument": "EUR_USD", "side": 1, "features": {"rsi": 70, "hour_ny": 15, "body_atr": 2}}
        tags = tag_mistakes(row, -1.0, 1, 0.2)
        for t in ("stopped_fast", "overextended_rsi", "late_session", "big_candle_chase"):
            self.assertIn(t, tags)
        self.assertIn("gave_back", tag_mistakes(row, 0.0, 9, 1.3))
        self.assertEqual(tag_mistakes(row, 2.0, 9, 2.0), [])


class LearnFilters(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.L = Learner({"min_samples": 20, "reports_dir": self.tmp.name}, clock=lambda: NOW)

    def tearDown(self):
        self.tmp.cleanup()

    def test_learns_to_avoid_losing_condition_and_unlearns(self):
        for i in range(30):                       # late-session entries keep losing
            add_done(self.L, sig(hour_ny=15), -1.0 if i % 5 else 2.0)
        for i in range(30):                       # normal entries win
            add_done(self.L, sig(hour_ny=10), 2.0 if i % 2 else -1.0)
        self.L.learn_filters("2026-11-03")
        self.assertIn("late_session", self.L.filters())
        self.assertIn("hour:15", self.L.filters())
        self.assertIn("learned filter", self.L.blocked(sig(hour_ny=15)))
        self.assertIsNone(self.L.blocked(sig(hour_ny=10)))
        # shadow results for late-session setups turn positive -> rule is dropped
        for _ in range(60):
            add_done(self.L, sig(hour_ny=15), 2.0)
        self.L.learn_filters("2026-11-04")
        self.assertNotIn("late_session", self.L.filters())
        texts = [l["text"] for l in self.L.lessons()]
        self.assertTrue(any(t.startswith("New rule") for t in texts))
        self.assertTrue(any(t.startswith("Rule removed") for t in texts))

    def test_needs_enough_samples(self):
        for _ in range(5):
            add_done(self.L, sig(hour_ny=15), -1.0)
        self.L.learn_filters("d")
        self.assertEqual(self.L.filters(), [])

    def test_resolve_follows_signal_on_chart(self):
        t0 = NOW - 3600 * 20
        s = sig(t=t0)
        s.stop_distance = 1.0
        self.L.record_signal(s, taken=False)
        bars = [Candle(t0, 100, 100.5, 99.5, 100)]
        bars += [Candle(t0 + 3600 * k, 100 + k * 0.3, 100.6 + k * 0.3, 99.9 + k * 0.3, 100.4 + k * 0.3)
                 for k in range(1, 10)]
        self.assertEqual(self.L.resolve("EUR_USD", bars, 3600, reward_risk=2.0), 1)
        row = self.L._rows("1=1")[0]
        self.assertEqual(row["status"], "done")
        self.assertAlmostEqual(row["r"], 2.0)

    def test_daily_review_writes_report_and_never_touches_risk(self):
        add_done(self.L, sig(), -1.0, bars=1)
        out = self.L.daily_review("2026-11-03")
        self.assertIn("stopped_fast", out["mistakes"])
        path = os.path.join(self.tmp.name, "2026-11-03.md")
        self.assertTrue(os.path.exists(path))
        self.assertIn("Mistakes found", open(path).read())
        self.assertNotIn("risk_per_trade_pct", json.dumps(self.L.params()))

    def test_tuning_only_adopts_change_that_also_wins_on_unseen_data(self):
        import math
        import random
        rnd = random.Random(3)
        htf = trend_candles(1500, step=2.0, period_s=14400, wiggle=6)
        ltf, prev = [], 2000.0
        for i in range(3000):
            c = 2000 + 0.5 * i + 10 * math.sin(i / 5) + rnd.gauss(0, 3)
            ltf.append(Candle(1_700_000_000 + 210 * 14400 + i * 3600, prev,
                              max(prev, c) + abs(rnd.gauss(0, 1)), min(prev, c) - abs(rnd.gauss(0, 1)), c))
            prev = c
        res = self.L.tune("2026-11-03", lambda n: (htf, ltf), {"rsi_buy_min": 0, "rsi_buy_max": 100}, 2.0, ["XAU_USD"])
        lesson = self.L.lessons(1)[0]["text"]
        if res:
            key, new, tr, te, old = res
            self.assertEqual(self.L.params()[key], new)
            self.assertGreaterEqual(te, 0)
            self.assertIn("unseen", lesson)
        else:
            self.assertIn("No change", lesson)
            self.assertEqual(self.L.params(), {})


class ChartReader(unittest.TestCase):
    def test_states(self):
        htf, ltf = pullback_setup(1)
        r = strategy.read_chart("XAU_USD", htf, ltf, {"rsi_buy_min": 0, "rsi_buy_max": 100})
        self.assertEqual(r["state"], "signal")
        self.assertEqual(len(r["candles"]), len(r["ema"]))
        flat = trend_candles(260, step=0.0, period_s=14400)
        self.assertEqual(strategy.read_chart("XAU_USD", flat, ltf)["state"], "none")
        far = trend_candles(80, start=2400, step=3.0)
        r = strategy.read_chart("XAU_USD", htf, far)
        self.assertEqual(r["state"], "watch")
        self.assertIn("bahut door", r["note"])

    def test_forming(self):
        htf, _ = pullback_setup(1)
        ltf = trend_candles(60, start=2400, step=0.3)
        last = ltf[-1]
        for k in range(1, 4):                     # three red candles pulling back toward the EMA
            o = last.c
            c = o - 0.9
            last = Candle(last.time + 3600, o, o + 0.1, c - 0.1, c)
            ltf.append(last)
        r = strategy.read_chart("XAU_USD", htf, ltf)
        self.assertEqual(r["state"], "forming")
        self.assertIn("zone ban raha", r["note"])


def make_engine(tmp, side=1, sessions=None):
    b = SimBroker(10_000, spread=0.2, instruments=[XAU])
    htf, ltf = pullback_setup(side)
    b.data[("XAU_USD", "H4")], b.data[("XAU_USD", "H1")] = htf, ltf
    b.mid["XAU_USD"] = ltf[-1].c
    cfg = {"engine": {"instruments": ["XAU_USD"], "kill_file": os.path.join(tmp, "STOP"),
                      "entry_sessions_ny": sessions if sessions is not None else []},
           "strategy": {"rsi_buy_min": 0, "rsi_buy_max": 100, "rsi_sell_min": 0, "rsi_sell_max": 100},
           "learning": {"reports_dir": os.path.join(tmp, "reports")}, "news": {"enabled": False}}
    clock = [ltf[-1].time + 3600 + 30]
    return b, Engine(b, cfg, clock=lambda: clock[0]), clock


class EngineLearning(unittest.TestCase):
    def test_session_filter_blocks_but_still_learns(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, clock = make_engine(d, sessions=[["08:00", "16:00"]])
            ny_hour = datetime.fromtimestamp(clock[0], timezone.utc).astimezone(
                __import__("zoneinfo").ZoneInfo("America/New_York")).hour
            e.tick()
            rows = e.learner._rows("1=1")
            self.assertEqual(len(rows), 1)
            if 8 <= ny_hour < 16 and datetime.fromtimestamp(clock[0]).weekday() < 5:
                self.assertEqual(len(b.orders), 1)
            else:
                self.assertEqual(b.orders, [])
                self.assertEqual(rows[0]["skip_reason"], "outside US session")

    def test_in_session_hours(self):
        with tempfile.TemporaryDirectory() as d:
            _, e, _ = make_engine(d, sessions=[["08:00", "16:00"]])
            tue_10am = datetime(2026, 11, 3, 15, 0, tzinfo=timezone.utc).timestamp()   # 10:00 ET
            tue_7pm = datetime(2026, 11, 4, 0, 0, tzinfo=timezone.utc).timestamp()     # 19:00 ET
            sat = datetime(2026, 11, 7, 15, 0, tzinfo=timezone.utc).timestamp()
            self.assertTrue(e.in_session(tue_10am))
            self.assertFalse(e.in_session(tue_7pm))
            self.assertFalse(e.in_session(sat))

    def test_learned_filter_blocks_trade(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, _ = make_engine(d)
            e.learner.put("filters", ["instrument:XAU_USD"])
            e.tick()
            self.assertEqual(b.orders, [])
            self.assertIn("learned filter", e.learner._rows("1=1")[0]["skip_reason"])

    def test_learned_reward_risk_is_used(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, _ = make_engine(d)
            e.learner.put("params", {"reward_risk": 3.0})
            e.tick()
            t = b.orders[0]
            self.assertAlmostEqual(t.take_profit - t.entry, 3 * (t.entry - t.stop), places=6)

    def test_real_result_recorded_on_close(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, clock = make_engine(d)
            e.tick()
            t = b.orders[0]
            b.move("XAU_USD", t.stop - 0.5)          # stopped out
            clock[0] += 30
            e.tick()
            row = e.learner._rows("taken=1")[0]
            self.assertAlmostEqual(row["real_r"], -1.0, places=6)

    def test_review_runs_when_day_rolls(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, clock = make_engine(d)
            e.background_review = False
            e.tick()
            day1 = e.risk.state["day"]
            clock[0] += 86400
            e.tick()
            self.assertEqual(e.learner.get("last_review_day"), day1)
            self.assertTrue(os.path.exists(os.path.join(d, "reports", f"{day1}.md")))

    def test_dashboard_serves_board(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, _ = make_engine(d)
            e.tick()
            srv = dashboard.start(e, "127.0.0.1", 0)
            port = srv.server_address[1]
            try:
                html = urllib.request.urlopen(f"http://127.0.0.1:{port}/").read().decode()
                self.assertIn("Trade Bot", html)
                state = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/api/state").read())
                self.assertEqual(state["charts"][0]["instrument"], "XAU_USD")
                self.assertEqual(state["charts"][0]["state"], "signal")
                self.assertIn("learning", state)
            finally:
                srv.shutdown()


if __name__ == "__main__":
    unittest.main()


class SessionLearning(unittest.TestCase):
    def test_night_setups_teach_setup_rules_but_never_time_rules(self):
        with tempfile.TemporaryDirectory() as d:
            L = Learner({"min_samples": 20, "reports_dir": d}, clock=lambda: NOW)
            for _ in range(40):                       # night setups with a WEAK trend that all lose
                s = sig(hour_ny=22, trend_strength=0.05)
                rid = L.record_signal(s, taken=False, skip_reason="outside US session")
                L._update(rid, status="done", r=-1.0, bars_held=5, max_r=0.1, mistakes="[]")
            for i in range(30):                       # normal in-session setups
                add_done(L, sig(hour_ny=10), 2.0 if i % 2 else -1.0)
            L.learn_filters("d")
            self.assertIn("weak_trend", L.filters())          # the setup lesson counts
            self.assertNotIn("hour:22", L.filters())          # but no time-of-day rule from the night
            self.assertNotIn("late_session", L.filters())
            snap = L.snapshot()
            self.assertEqual(snap["stats_30d"]["off_session"]["n"], 40)
            self.assertEqual(snap["stats_30d"]["in_session"]["n"], 30)
            row = {"instrument": "EUR_USD", "side": 1, "skip_reason": "outside US session",
                   "features": {"hour_ny": 22, "rsi": 80}}
            tags = tag_mistakes(row, -1.0, 1, 0.1)
            self.assertIn("overextended_rsi", tags)
            self.assertNotIn("late_session", tags)

    def test_report_card_on_history(self):
        import math
        import random
        rnd = random.Random(7)
        htf = trend_candles(1500, step=2.0, period_s=14400, wiggle=6)
        ltf, prev = [], 2000.0
        for i in range(3000):
            c = 2000 + 0.5 * i + 10 * math.sin(i / 5) + rnd.gauss(0, 3)
            ltf.append(Candle(1_700_000_000 + 210 * 14400 + i * 3600, prev,
                              max(prev, c) + abs(rnd.gauss(0, 1)), min(prev, c) - abs(rnd.gauss(0, 1)), c))
            prev = c
        with tempfile.TemporaryDirectory() as d:
            L = Learner({"reports_dir": d}, clock=lambda: NOW)
            card = L.validate("d", lambda n: (htf, ltf), ["XAU_USD", "BAD"], {"rsi_buy_min": 0, "rsi_buy_max": 100},
                              2.0, in_session=lambda t, n: (t // 3600) % 24 >= 13)
            self.assertGreater(card["all"]["n"], 10)
            self.assertEqual(card["in_session"]["n"] + card["off_session"]["n"], card["all"]["n"])
            self.assertIn(card["verdict"], ("pass", "weak", "few"))
            self.assertEqual(L.snapshot()["report_card"]["all"], card["all"])
            self.assertIn("Report card", L.lessons(1)[0]["text"])


class IndexSessions(unittest.TestCase):
    def test_stock_index_only_while_wall_street_open(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, _ = make_engine(d, sessions=[["08:00", "16:00"]])
            nas = Instrument("NAS100_USD", "CFD", 1, 1, 1)
            e._universe = [nas]
            t0900 = datetime(2026, 11, 3, 14, 0, tzinfo=timezone.utc).timestamp()   # 09:00 NY
            t1000 = datetime(2026, 11, 3, 15, 0, tzinfo=timezone.utc).timestamp()   # 10:00 NY
            self.assertTrue(e.in_session(t0900))            # forex window open
            self.assertFalse(e.in_session(t0900, nas))      # Wall Street not open yet
            self.assertTrue(e.in_session(t1000, "NAS100_USD"))
            self.assertEqual(e.why_no_new_trades(t0900, nas), "outside US session")


class EngineReportCard(unittest.TestCase):
    def test_engine_validate_uses_real_session_function(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, _ = make_engine(d, sessions=[["08:00", "16:00"]])
            import math
            ltf, prev = [], 2400.0
            for i in range(600):
                c = 2400 + 0.3 * i + 8 * math.sin(i / 5)
                ltf.append(Candle(1_700_000_000 + i * 3600, prev, max(prev, c) + 0.5, min(prev, c) - 0.5, c))
                prev = c
            b.data[("XAU_USD", "H1")] = ltf
            e.validate_setup("2026-11-04")
            card = e.learner.get("report_card")
            self.assertIn(card["verdict"], ("pass", "weak", "few"))
            self.assertEqual(card["in_session"]["n"] + card["off_session"]["n"], card["all"]["n"])
