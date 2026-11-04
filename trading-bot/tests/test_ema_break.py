import os
import tempfile
import unittest
from datetime import datetime, timezone

from bot import ema_break
from bot.broker.sim import SimBroker
from bot.engine import Engine
from bot.models import Candle, Instrument

XAU = Instrument("XAU_USD", "METAL", display_precision=3, units_precision=0, min_units=1)
# Tue 3 Nov 2026 09:00 New York = 14:00 UTC
T0 = datetime(2026, 11, 3, 14, 0, tzinfo=timezone.utc).timestamp()


def uptrend(n=60, start=2400.0, t0=T0 - 60 * 300):
    """Steady 5-minute uptrend with small candles that sit on the EMAs."""
    out, prev = [], start
    for i in range(n):
        c = prev + 0.5
        out.append(Candle(t0 + i * 300, prev, c + 0.2, prev - 3.0, c))      # wick dips into the EMAs
        prev = c
    return out


def alert_after(candles, gap=2.0, size=2.0, bull=True):
    """Append a candle clearly above the EMAs (BUY alert) or below (SELL alert)."""
    last = candles[-1]
    t = last.time + 300
    if bull:
        lo = last.c + gap
        return candles + [Candle(t, lo + 0.2, lo + size, lo, lo + size - 0.2)]
    hi = last.c - gap
    return candles + [Candle(t, hi - 0.2, hi, hi - size, hi - size + 0.2)]


class Rules(unittest.TestCase):
    def test_buy_alert_entry_and_stop(self):
        c = alert_after(uptrend())
        s = ema_break.evaluate("XAU_USD", c, {"min_stop_atr": 0, "max_stop_atr": 99})
        self.assertIsNotNone(s)
        self.assertEqual(s.side, 1)
        self.assertEqual(s.entry_price, c[-1].h)
        self.assertEqual(s.stop_price, c[-1].l)

    def test_candle_touching_ema_is_not_an_alert(self):
        c = uptrend()                       # last candle's low is on the EMAs
        self.assertIsNone(ema_break.evaluate("XAU_USD", c, {"min_stop_atr": 0, "max_stop_atr": 99}))

    def test_no_buy_alert_in_downtrend(self):
        down = [Candle(x.time, -x.o + 5000, -x.l + 5000, -x.h + 5000, -x.c + 5000) for x in uptrend()]
        c = alert_after(down, bull=True)
        self.assertIsNone(ema_break.evaluate("XAU_USD", c, {"min_stop_atr": 0, "max_stop_atr": 99}))
        s = ema_break.evaluate("XAU_USD", alert_after(down, bull=False), {"min_stop_atr": 0, "max_stop_atr": 99})
        self.assertEqual(s.side, -1)

    def test_atr_size_filter(self):
        c = alert_after(uptrend(), size=40.0)       # far too big vs ATR
        self.assertIsNone(ema_break.evaluate("XAU_USD", c))

    def test_window(self):
        self.assertTrue(ema_break.in_window(T0, [["08:00", "12:00"]]))
        self.assertFalse(ema_break.in_window(T0 + 4 * 3600, [["08:00", "12:00"]]))


class Backtest(unittest.TestCase):
    def build(self, follow):
        c = alert_after(uptrend(), size=2.0)
        a = c[-1]
        nxt = Candle(a.time + 300, a.c, a.h + 0.5, a.c - 0.1, a.h + 0.3)       # breaks the high
        rest = [Candle(nxt.time + 300 * (k + 1), y, y + 0.2, y - 0.2, y) for k, y in enumerate(follow)]
        return c + [nxt] + rest, a

    def test_target_hit_is_3r_minus_spread(self):
        c, a = self.build([2460 + k for k in range(20)])
        t = ema_break.backtest(c, {"min_stop_atr": 0, "max_stop_atr": 99})
        self.assertGreaterEqual(len(t), 1)
        self.assertEqual(t[0]["time"], a.time + 300)
        self.assertAlmostEqual(t[0]["r"], 3.0)
        t2 = ema_break.backtest(c, {"min_stop_atr": 0, "max_stop_atr": 99}, spread=0.5)
        self.assertLess(t2[0]["r"], 3.0)

    def test_stop_hit_is_minus_1r(self):
        c, a = self.build([a_ for a_ in [2400] * 5])
        t = ema_break.backtest(c, {"min_stop_atr": 0, "max_stop_atr": 99})
        self.assertAlmostEqual(t[0]["r"], -1.0)

    def test_no_break_no_trade_and_outside_window(self):
        c = alert_after(uptrend(), size=2.0)
        a = c[-1]
        c.append(Candle(a.time + 300, a.c, a.h - 0.1, a.l + 0.1, a.c))      # does NOT break the high
        c += [Candle(a.time + 600 + k * 300, 2500, 2500, 2500, 2500) for k in range(5)]
        self.assertEqual(ema_break.backtest(c, {"min_stop_atr": 0, "max_stop_atr": 99}), [])
        c2, _ = self.build([2460 + k for k in range(20)])
        self.assertEqual(ema_break.backtest(c2, {"min_stop_atr": 0, "max_stop_atr": 99}, windows=[["13:00", "14:00"]]), [])


def make(tmp, gate=True, candles=None):
    b = SimBroker(10_000, spread=0.0, instruments=[XAU])
    c = candles or alert_after(uptrend(), size=2.0)
    b.data[("XAU_USD", "M5")] = c
    b.mid["XAU_USD"] = c[-1].c
    cfg = {"engine": {"instruments": ["XAU_USD"], "strategy": "ema_break", "entry_timeframe": "M5",
                      "entry_sessions_ny": [["08:00", "12:00"]], "kill_file": os.path.join(tmp, "STOP")},
           "strategy": {"min_stop_atr": 0, "max_stop_atr": 99},
           "risk": {"risk_per_trade_pct": 0.5, "max_correlation": 2}, "news": {"enabled": False},
           "learning": {"reports_dir": tmp}}
    clock = [c[-1].time + 300 + 20]
    e = Engine(b, cfg, clock=lambda: clock[0])
    e.cfg["trade_mode"] = "list"
    e.base_params["max_trades_per_day"] = 2
    e._validated_once = True
    if gate:
        e.learner.put("gate", {"passed": True})
    return b, e, clock


class EngineEma(unittest.TestCase):
    def test_gate_blocks_until_backtest_passes(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, _ = make(d, gate=False)
            e.tick()
            self.assertEqual(getattr(b, "pending", {}), {})
            j = e.snapshot()["journeys"][0]
            self.assertIn("Shadow", [s for s in j["steps"] if s["verdict"] == "block"][0]["text"])

    def test_stop_order_fills_and_trade_is_tracked(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, clock = make(d)
            e.tick()
            (oid, o), = b.pending.items()
            a = b.data[("XAU_USD", "M5")][-1]
            self.assertEqual(o["price"], a.h)
            self.assertEqual(o["stop"], a.l)
            self.assertAlmostEqual(o["tp"] - o["price"], 3 * (a.h - a.l))
            self.assertLessEqual((a.h - a.l) * o["units"], 50.0 + 1e-6)         # 0.5% of 10k
            b.move("XAU_USD", a.h + 0.1)                                          # break -> fill
            clock[0] += 30
            e.tick()
            self.assertEqual(len(b.trades), 1)
            self.assertEqual(e.trades_today(), 1)
            self.assertEqual(e.snapshot()["journeys"][0]["state"], "trade open")
            b.move("XAU_USD", o["tp"] + 0.1)
            clock[0] += 30
            e.tick()
            closed = e.learner.closed_trades()
            self.assertEqual(len(closed), 1)
            self.assertAlmostEqual(closed[0]["r"], 3.0, places=2)

    def test_unbroken_setup_is_cancelled(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, clock = make(d)
            e.tick()
            clock[0] += 1200                                                      # next candle passed, no break
            e.tick()
            self.assertEqual(e.risk.state["pending"], {})
            self.assertEqual(list(b.pending.values())[0]["state"], "CANCELLED")
            self.assertEqual(e.trades_today(), 0)

    def test_max_two_trades_per_day(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, _ = make(d)
            e.risk.state["day_trades"] = {ema_break.ny_day(e.clock()): 2}
            e.tick()
            self.assertEqual(getattr(b, "pending", {}), {})

    def test_daily_limit_counts_open_risk(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, _ = make(d)
            e.risk.p["daily_loss_limit_pct"] = 0.6               # 60 on 10k; one trade risks 50
            e.risk.state["trades"]["x"] = {"instrument": "XAU_USD", "units": 10, "entry": 2400, "stop": 2399}
            e.tick()                                              # 10 open risk + 50 new = 60 -> allowed
            self.assertEqual(len(b.pending), 1)
        with tempfile.TemporaryDirectory() as d:
            b, e, _ = make(d)
            e.risk.p["daily_loss_limit_pct"] = 0.6
            e.risk.state["trades"]["x"] = {"instrument": "XAU_USD", "units": 10, "entry": 2400, "stop": 2397}
            e.tick()                                              # 30 + 50 = 80 > 60 -> blocked
            self.assertEqual(getattr(b, "pending", {}), {})

    def test_engine_backtest_and_gate(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, _ = make(d, gate=False)
            self.assertIsNone(e.ema_backtest("t"))                 # 60 candles: not enough history
            self.assertFalse(e.gate())
            long = uptrend(800, t0=T0 - 800 * 300)
            b.data[("XAU_USD", "M5")] = alert_after(long)
            r = e.ema_backtest("t")
            self.assertIn("unseen", r)
            self.assertFalse(r["passed"])                          # far fewer than 100 unseen trades
            self.assertIn("unseen mein sirf", r["reason"])
            self.assertFalse(e.gate())
            self.assertEqual(e.snapshot()["mode"]["strategy"], "ema_break")


class Shadow(unittest.TestCase):
    def test_shadow_setup_is_followed_with_breakout_rules(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, clock = make(d, gate=False)
            e.tick()                                                      # shadow: recorded, no order
            self.assertEqual(getattr(b, "pending", {}), {})
            rows = e.learner._rows("1=1")
            self.assertEqual((len(rows), rows[0]["taken"], rows[0]["skip_reason"]), (1, 0, "shadow"))
            c = b.data[("XAU_USD", "M5")]
            a = c[-1]
            brk = Candle(a.time + 300, a.c, a.h + 0.5, a.c - 0.1, a.h + 0.3)
            up = [Candle(brk.time + 300 * (k + 1), a.h + k, a.h + k + 20, a.h + k, a.h + k + 1) for k in range(3)]
            b.data[("XAU_USD", "M5")] = c + [brk] + up
            clock[0] = up[-1].time + 300 + 20
            e.tick()
            row = e.learner._rows("1=1")[0]
            self.assertEqual(row["status"], "done")
            self.assertAlmostEqual(row["r"], 3.0)
            snap = e.learner.snapshot()
            self.assertEqual(snap["shadow_30d"]["n"], 1)
            self.assertEqual(snap["real_30d"]["n"], 0)

    def test_unbroken_shadow_is_cancelled(self):
        from bot.ema_break import follow
        bar = Candle(0, 10, 10.5, 9.5, 10)
        self.assertEqual(follow(1, 11, 9, 3, [bar]), ("cancel", 1))
        self.assertIsNone(follow(1, 11, 9, 3, []))

    def test_research_adds_only_cells_good_on_both_halves(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, _ = make(d, gate=False)
            e.cfg.update(cell_min_unseen_trades=1, cell_min_unseen_pf=1.2, cell_min_tuning_pf=1.1)
            import bot.ema_break as eb
            real = eb.backtest
            t0 = T0 - 100 * 86400
            fake = [{"time": t0 + k * 86400, "hour": 9 if k % 2 else 3, "r": (3.0 if k % 2 else -1.0), "day": "x", "side": 1}
                    for k in range(100)]
            eb.backtest = lambda *a, **kw: fake
            try:
                long = uptrend(600, t0=t0)
                b.data[("XAU_USD", "M5")] = long + [Candle(T0 + 300 * k, 1, 1, 1, 1) for k in range(1)]
                b.data[("XAU_USD", "M5")][-1] = Candle(t0 + 100 * 86400, 1, 1, 1, 1)
                r = e.ema_research("t")
            finally:
                eb.backtest = real
            hours = {(c["instrument"], c["hour"]) for c in e.learner.get("trade_list")}
            self.assertIn(("XAU_USD", 9), hours)                       # always +3R
            self.assertNotIn(("XAU_USD", 3), hours)                    # always -1R
            self.assertGreater(r["cells_tested"], 0)
            nine = datetime(2026, 11, 3, 14, 30, tzinfo=timezone.utc).timestamp()     # 09:30 NY
            self.assertTrue(e.trade_allowed("XAU_USD", nine))
            three = datetime(2026, 11, 3, 8, 30, tzinfo=timezone.utc).timestamp()     # 03:30 NY
            self.assertFalse(e.trade_allowed("XAU_USD", three))


class Forward(unittest.TestCase):
    def test_forward_records_and_follows_setup(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, clock = make(d, gate=False)
            c = alert_after(uptrend(), size=2.0)
            b.data[("XAU_USD", "H1")] = c
            e.cfg["forward_tests"] = [{"instrument": "XAU_USD", "timeframe": "H1", "reward_risk": 3.0}]
            e.forward_tick(clock[0])
            v = e.forward_view()[0]
            self.assertEqual(v["open"], 1)
            a = c[-1]
            brk = Candle(a.time + 3600, a.c, a.h + 0.5, a.c - 0.1, a.h + 0.3)          # H1: one hour later
            up = [Candle(brk.time + 3600 * (k + 1), a.h + k, a.h + k + 20, a.h + k, a.h + k + 1) for k in range(3)]
            b.data[("XAU_USD", "H1")] = c + [brk] + up
            clock[0] += 5 * 3600
            e.forward_tick(clock[0])
            v = e.forward_view()[0]
            self.assertEqual(v["card"]["n"], 1)
            self.assertAlmostEqual(v["card"]["total_r"], 3.0)
            self.assertEqual(len(b.orders), 0)                  # never traded


if __name__ == "__main__":
    unittest.main()


class TradeEverywhere(unittest.TestCase):
    def test_all_mode_trades_without_gate_or_daily_cap(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, _ = make(d, gate=False)
            e.cfg["trade_mode"] = "all"
            e.base_params["max_trades_per_day"] = 0
            e.risk.state["day_trades"] = {ema_break.ny_day(e.clock()): 50}
            e.tick()
            self.assertEqual(len(b.pending), 1)
            self.assertTrue(e.trade_allowed("EUR_USD", e.clock() + 10 * 3600))   # any chart, any hour


class BoardRobustness(unittest.TestCase):
    def test_forming_chart_does_not_crash_scan_and_backtest_starts(self):
        with tempfile.TemporaryDirectory() as d:
            c = uptrend()                                # last candle touches the EMAs -> "forming"
            b, e, _ = make(d, candles=c)
            e._validated_once = False
            started = []
            e.validate_setup = lambda day: started.append(day)
            import threading
            real = threading.Thread
            threading.Thread = lambda target, args=(), daemon=None: type("T", (), {"start": lambda s: target(*args)})()
            try:
                e.tick()
            finally:
                threading.Thread = real
            self.assertEqual(e.board["XAU_USD"]["state"], "forming")
            self.assertIn("risk", e.status)                     # status filled = scan finished
            self.assertEqual(len(started), 1)                   # backtest/research was started


class Variations(unittest.TestCase):
    def test_variations_table(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, _ = make(d, gate=False)
            long = alert_after(uptrend(800, t0=T0 - 800 * 300))
            b.data[("XAU_USD", "M5")] = long
            b.data[("XAU_USD", "M15")] = long
            r = e.ema_variations("t")
            self.assertEqual(len(r["rows"]), 10)                     # M5, M15 x 5 targets (H1/H4 have no data)
            self.assertEqual({x["rr"] for x in r["rows"]}, {1.5, 2.0, 3.0, 4.0, 5.0})
            self.assertEqual(e.snapshot()["mode"]["variations"]["instrument"], "XAU_USD")
