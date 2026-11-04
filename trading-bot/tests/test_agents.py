import json
import os
import tempfile
import unittest

from bot.agents import AgentLog
from tests.test_learning import make_engine


class AgentLogTests(unittest.TestCase):
    def test_counts_reset_with_day_and_persist(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "a.json")
            a = AgentLog(p, clock=lambda: 100)
            a.set_day("2026-11-04")
            a.count("scanner", "scans")
            a.handoff("scanner", "reader", "12 charts", n=12)
            a.journey_start("EUR_USD@1", "EUR_USD", 1, 1, "x")
            a.step("EUR_USD@1", "timer", "block", "US session band")
            a.save()
            b = AgentLog(p)
            self.assertEqual(b.agents["scanner"]["counts"]["scans"], 1)
            self.assertEqual(b.agents["scanner"]["handoffs"]["reader"], 12)
            self.assertEqual(b.journeys["EUR_USD@1"]["state"], "roka gaya")
            b.set_day("2026-11-05")
            self.assertEqual(b.agents["scanner"]["counts"], {})


class EngineJourney(unittest.TestCase):
    def test_full_journey_scanner_to_learner(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, clock = make_engine(d)
            e.tick()
            snap = e.snapshot()
            j = snap["journeys"][0]
            self.assertEqual([s["agent"] for s in j["steps"]],
                             ["scanner", "reader", "rules", "timer", "risk", "executor"])
            self.assertTrue(j["taken"])
            ag = {a["id"]: a for a in snap["agents"]}
            self.assertEqual(ag["executor"]["handoffs"]["manager"], 1)
            self.assertEqual(ag["rules"]["handoffs"]["timer"], 1)
            # stop-out -> Exit Planner records result and hands it to the Time Machine
            t = b.orders[0]
            b.move("XAU_USD", t.stop - 0.5)
            clock[0] += 30
            e.tick()
            snap = e.snapshot()
            j = snap["journeys"][0]
            self.assertEqual(j["state"], "khatam")
            self.assertAlmostEqual(j["r"], -1.0, places=2)
            ag = {a["id"]: a for a in snap["agents"]}
            self.assertEqual(ag["manager"]["handoffs"]["learner"], 1)
            json.dumps(snap)  # dashboard must be able to serialise it

    def test_blocked_signal_goes_to_learner(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, _ = make_engine(d)
            e.learner.put("filters", ["instrument:XAU_USD"])
            e.tick()
            j = e.snapshot()["journeys"][0]
            self.assertFalse(j["taken"])
            self.assertEqual(j["state"], "roka gaya")
            blocked = [s for s in j["steps"] if s["verdict"] == "block"][0]
            self.assertEqual(blocked["agent"], "timer")
            self.assertIn("Seekha hua rule", blocked["text"])
            ag = {a["id"]: a for a in e.snapshot()["agents"]}
            self.assertEqual(ag["timer"]["handoffs"]["learner"], 1)


if __name__ == "__main__":
    unittest.main()


class LivePrices(unittest.TestCase):
    def test_live_prices_cached_and_served(self):
        import urllib.request
        from bot import dashboard
        with tempfile.TemporaryDirectory() as d:
            b, e, _ = make_engine(d)
            e.tick()
            p = e.live_prices()
            self.assertIn("XAU_USD", p["prices"])
            self.assertAlmostEqual(p["prices"]["XAU_USD"]["mid"], b.mid["XAU_USD"])
            b.mid["XAU_USD"] += 5
            self.assertIs(e.live_prices(), p)                     # cached for 2 s
            srv = dashboard.start(e, "127.0.0.1", 0)
            try:
                got = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{srv.server_address[1]}/api/prices").read())
                self.assertIn("XAU_USD", got["prices"])
            finally:
                srv.shutdown()


class SlTpAmounts(unittest.TestCase):
    def test_open_trade_shows_money_at_sl_and_tp(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, _ = make_engine(d)
            e.tick()
            t = e.status["open_trades"][0]
            risk = abs(t["entry"] - t["stop"]) * abs(t["units"])
            self.assertAlmostEqual(t["sl_amt"], -risk, places=1)
            self.assertAlmostEqual(t["tp_amt"], 2 * risk, places=1)
            self.assertLessEqual(-t["sl_amt"], 100.0 + 1e-6)     # <= 1% of 10k as configured


class RestartSafety(unittest.TestCase):
    def test_close_recorded_after_restart_and_no_rescan(self):
        from bot.engine import Engine
        with tempfile.TemporaryDirectory() as d:
            b, e, clock = make_engine(d)
            st, mem, ag = (os.path.join(d, x) for x in ("s.json", "m.db", "a.json"))
            cfg = {"engine": {"instruments": ["XAU_USD"], "kill_file": os.path.join(d, "STOP"), "entry_sessions_ny": []},
                   "strategy": {"rsi_buy_min": 0, "rsi_buy_max": 100}, "news": {"enabled": False},
                   "learning": {"reports_dir": d}}
            e = Engine(b, cfg, state_path=st, memory_path=mem, agents_path=ag, clock=lambda: clock[0])
            e.tick()
            self.assertEqual(len(b.orders), 1)
            t = b.orders[0]
            # restart: brand-new engine object, same files
            e2 = Engine(b, cfg, state_path=st, memory_path=mem, agents_path=ag, clock=lambda: clock[0])
            clock[0] += 30
            e2.tick()
            self.assertEqual(len(e2.learner._rows("1=1")), 1)          # same candle not scanned twice
            b.move("XAU_USD", t.take_profit + 0.1)                      # target hit while "restarted"
            clock[0] += 30
            e2.tick()
            closed = e2.learner.closed_trades()
            self.assertEqual(len(closed), 1)
            self.assertEqual(closed[0]["how"], "TP 🎯")
            self.assertAlmostEqual(closed[0]["r"], 2.0, places=2)
            self.assertGreater(closed[0]["pl"], 0)
            self.assertEqual(e2.learner.closed_summary()["wins"], 1)
            self.assertNotIn(str(t.id), e2.risk.state["trades"])
