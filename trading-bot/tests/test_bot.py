import os
import tempfile
import unittest

from bot import strategy
from bot.backtest import run as bt_run, summary
from bot.broker.sim import SimBroker
from bot.engine import Engine
from bot.indicators import atr, ema, rsi
from bot.models import Account, Candle, Instrument, Price, Signal, Trade
from bot.risk import RiskManager, trading_day
from tests.helpers import pullback_setup, trend_candles

XAU = Instrument("XAU_USD", "METAL", display_precision=3, units_precision=0, min_units=1)


class Indicators(unittest.TestCase):
    def test_ema_constant(self):
        self.assertAlmostEqual(ema([5.0] * 30, 10)[-1], 5.0)

    def test_rsi_all_up_is_100(self):
        self.assertEqual(rsi(list(range(40)), 14)[-1], 100.0)

    def test_atr_constant_range(self):
        h = [11.0] * 30
        l = [9.0] * 30
        c = [10.0] * 30
        self.assertAlmostEqual(atr(h, l, c, 14)[-1], 2.0)


class Strategy(unittest.TestCase):
    def test_buy_signal_in_uptrend_pullback(self):
        htf, ltf = pullback_setup(1)
        s = strategy.evaluate("XAU_USD", htf, ltf, {"rsi_buy_min": 0, "rsi_buy_max": 100})
        self.assertIsNotNone(s)
        self.assertEqual(s.side, 1)
        self.assertGreater(s.stop_distance, 0)

    def test_sell_signal_in_downtrend_pullback(self):
        htf, ltf = pullback_setup(-1)
        s = strategy.evaluate("XAU_USD", htf, ltf, {"rsi_sell_min": 0, "rsi_sell_max": 100})
        self.assertIsNotNone(s)
        self.assertEqual(s.side, -1)

    def test_no_buy_against_htf_trend(self):
        _, ltf = pullback_setup(1)
        htf_down = trend_candles(260, step=-2.0, period_s=14400)
        self.assertIsNone(strategy.evaluate("XAU_USD", htf_down, ltf, {"rsi_buy_min": 0, "rsi_buy_max": 100}))

    def test_ignores_incomplete_last_candle(self):
        htf, ltf = pullback_setup(1)
        ltf[-1].complete = False   # the signal bar is still forming -> no signal
        self.assertIsNone(strategy.evaluate("XAU_USD", htf, ltf, {"rsi_buy_min": 0, "rsi_buy_max": 100}))

    def test_not_enough_history(self):
        htf, ltf = pullback_setup(1)
        self.assertIsNone(strategy.evaluate("XAU_USD", htf[:50], ltf))


class Risk(unittest.TestCase):
    def test_size_rounds_down(self):
        r = RiskManager({"risk_per_trade_pct": 1.0})
        # $10,000 x 1% = $100 risk; stop $3 away -> 33.3 oz -> 33 units
        self.assertEqual(r.size(10_000, 3.0, 1.0, XAU), 33)

    def test_size_zero_when_stop_too_wide(self):
        r = RiskManager({"risk_per_trade_pct": 0.5})
        self.assertEqual(r.size(100, 80.0, 1.0, XAU), 0)

    def test_size_unknown_conversion(self):
        self.assertEqual(RiskManager().size(10_000, 3.0, 0.0, XAU), 0)

    def test_trading_day_rolls_at_5pm_new_york(self):
        # 2026-11-03 16:59 ET = 21:59 UTC ; 17:01 ET = 22:01 UTC (EST, UTC-5)
        from datetime import datetime, timezone
        before = datetime(2026, 11, 3, 21, 59, tzinfo=timezone.utc).timestamp()
        after = datetime(2026, 11, 3, 22, 1, tzinfo=timezone.utc).timestamp()
        self.assertEqual(trading_day(before), "2026-11-03")
        self.assertEqual(trading_day(after), "2026-11-04")

    def test_daily_loss_halts_then_resets_next_day(self):
        r = RiskManager({"daily_loss_limit_pct": 2.0, "max_drawdown_pct": 50})
        t = 1_762_000_000
        r.update(Account(10_000, 10_000), t)
        r.update(Account(9_790, 9_790), t + 60)
        self.assertIn("daily loss", r.halted)
        r.update(Account(9_790, 9_790), t + 86_400)
        self.assertIsNone(r.halted)

    def test_max_drawdown_halts_for_good(self):
        r = RiskManager({"daily_loss_limit_pct": 50, "max_drawdown_pct": 10})
        t = 1_762_000_000
        r.update(Account(10_000, 10_000), t)
        r.update(Account(8_900, 8_900), t + 86_400)
        r.update(Account(9_500, 9_500), t + 3 * 86_400)
        self.assertIn("max drawdown", r.halted)

    def test_state_survives_restart(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "s.json")
            r = RiskManager({"daily_loss_limit_pct": 2.0}, p)
            t = 1_762_000_000
            r.update(Account(10_000, 10_000), t)
            r.update(Account(9_700, 9_700), t + 60)
            self.assertTrue(RiskManager({}, p).halted)

    def test_exposure_and_spread_checks(self):
        r = RiskManager({"max_trades_per_currency": 1})
        sig = Signal("EUR_USD", 1, 0.0020, 0.0013, "x")
        open_ = [Trade("1", "XAU_USD", 5, 2000)]
        ok, why = r.can_open(sig, open_, Price(1.1, 1.1001))
        self.assertFalse(ok)
        self.assertIn("USD", why)
        ok, why = RiskManager().can_open(sig, [], Price(1.1, 1.1010))
        self.assertFalse(ok)
        self.assertIn("spread", why)
        ok, why = RiskManager().can_open(sig, [], Price(1.1, 1.1001, tradeable=False))
        self.assertFalse(ok)


class EngineTests(unittest.TestCase):
    def make(self, side=1, tmp=None):
        b = SimBroker(10_000, spread=0.2, instruments=[XAU])
        htf, ltf = pullback_setup(side)
        b.data[("XAU_USD", "H4")] = htf
        b.data[("XAU_USD", "H1")] = ltf
        b.mid["XAU_USD"] = ltf[-1].c
        cfg = {"engine": {"instruments": ["XAU_USD"], "kill_file": os.path.join(tmp or ".", "STOP_TEST"),
                          "entry_sessions_ny": []},
               "strategy": {"rsi_buy_min": 0, "rsi_buy_max": 100, "rsi_sell_min": 0, "rsi_sell_max": 100},
               "risk": {"risk_per_trade_pct": 1.0}}
        clock = [ltf[-1].time + 3600 + 30]
        e = Engine(b, cfg, clock=lambda: clock[0])
        return b, e, clock

    def test_opens_bracket_with_correct_risk(self):
        b, e, _ = self.make(1)
        e.tick()
        self.assertEqual(len(b.orders), 1)
        t = b.orders[0]
        self.assertGreater(t.units, 0)
        self.assertLess(t.stop, t.entry)
        self.assertAlmostEqual(t.take_profit - t.entry, 2 * (t.entry - t.stop), places=6)
        self.assertLessEqual((t.entry - t.stop) * t.units, 100.0 + 1e-9)   # <= 1% of 10k

    def test_scans_only_once_per_candle(self):
        b, e, clock = self.make(1)
        e.tick()
        b.close_trade(b.orders[0].id)
        clock[0] += 60
        e.tick()
        self.assertEqual(len(b.orders), 1)

    def test_kill_file_blocks_new_trades(self):
        with tempfile.TemporaryDirectory() as d:
            b, e, _ = self.make(1, tmp=d)
            open(os.path.join(d, "STOP_TEST"), "w").close()
            e.tick()
            self.assertEqual(b.orders, [])

    def test_breakeven_then_trailing_never_loosens(self):
        b, e, clock = self.make(1)
        e.tick()
        t = b.orders[0]
        r = t.entry - t.stop
        b.move("XAU_USD", t.entry + 1.05 * r + 0.1)       # +1R (bid side) -> breakeven
        clock[0] += 30
        e.tick()
        self.assertAlmostEqual(b.trades[t.id].stop, t.entry)
        b.move("XAU_USD", t.entry + 1.9 * r)             # trailing
        clock[0] += 30
        e.tick()
        trail = b.trades[t.id].stop
        self.assertGreater(trail, t.entry)
        b.move("XAU_USD", t.entry + 1.6 * r)             # pulls back: stop must NOT move down
        clock[0] += 30
        e.tick()
        self.assertEqual(b.trades[t.id].stop, trail)

    def test_short_side_and_stop_out(self):
        b, e, _ = self.make(-1)
        e.tick()
        t = b.orders[0]
        self.assertLess(t.units, 0)
        self.assertGreater(t.stop, t.entry)
        b.move("XAU_USD", t.stop + 1)
        self.assertEqual(b.trades, {})
        self.assertLess(b.balance, 10_000)

    def test_daily_halt_blocks_scan(self):
        b, e, _ = self.make(1)
        e.risk.state.update(day="2099-01-01")   # force reset on update
        b.balance = 10_000
        e.risk.update(Account(10_000, 10_000), e.clock())
        e.risk.state["halted_today"] = True
        b.balance = 9_950
        e.tick()
        self.assertEqual(b.orders, [])


class Backtest(unittest.TestCase):
    def test_backtest_runs_and_reports(self):
        import math
        import random
        rnd = random.Random(7)
        htf = trend_candles(1200, step=2.0, period_s=14400, wiggle=6)
        ltf, prev = [], 2000.0
        for i in range(4000):
            c = 2000 + 0.5 * i + 10 * math.sin(i / 5) + rnd.gauss(0, 3)
            ltf.append(Candle(1_700_000_000 + 210 * 14400 + i * 3600, prev,
                              max(prev, c) + abs(rnd.gauss(0, 1)), min(prev, c) - abs(rnd.gauss(0, 1)), c))
            prev = c
        trades = bt_run("XAU_USD", htf, ltf, params={"rsi_buy_min": 0, "rsi_buy_max": 100})
        s = summary(trades)
        self.assertGreater(s["trades"], 10)
        outcomes = {round(t["r"], 6) for t in trades}
        self.assertTrue(outcomes <= {-1.0, 0.0, 2.0}, outcomes)   # stop, breakeven or target only
        self.assertIn(-1.0, outcomes)                             # losses are counted too


class LiveGuard(unittest.TestCase):
    def test_live_requires_flag(self):
        import run
        with self.assertRaises(SystemExit) as cm:
            run.main(["live", "--config", "nope.json"])
        self.assertIn("real money", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
