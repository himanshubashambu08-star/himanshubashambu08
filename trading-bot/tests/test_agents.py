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
