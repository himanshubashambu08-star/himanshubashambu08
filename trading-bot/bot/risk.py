"""Risk rules. Every new trade must pass these checks; none of them can be skipped by the strategy.

- Size: risk_per_trade_pct of balance between entry and stop (always rounded DOWN).
- Daily loss limit: if equity falls daily_loss_limit_pct below the day's start, no new trades
  until the next trading day (day rolls at 17:00 New York, same as Trade Gate).
- Max drawdown: if equity falls max_drawdown_pct below its all-time peak, the bot halts for good
  until you delete the halt in the state file yourself.
- Limits on open trades in total, per instrument and per currency.
State is saved to a JSON file so a restart does not reset the daily limit.
"""
import json
import math
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")

DEFAULTS = {
    "risk_per_trade_pct": 0.5,
    "daily_loss_limit_pct": 2.0,
    "max_drawdown_pct": 10.0,
    "max_open_trades": 5,
    "max_trades_per_instrument": 1,
    "max_trades_per_currency": 2,
    "max_spread_to_stop": 0.15,
    "reward_risk": 2.0,
}


def trading_day(ts: float) -> str:
    """Trading day label. A new day starts at 17:00 New York time."""
    ny = datetime.fromtimestamp(ts, timezone.utc).astimezone(NY)
    return (ny + timedelta(hours=7)).date().isoformat()


def _currencies(instrument: str):
    return instrument.split("_")


class RiskManager:
    def __init__(self, params=None, state_path=None):
        self.p = {**DEFAULTS, **(params or {})}
        self.state_path = state_path
        self.state = {"day": None, "day_start_nav": None, "peak_nav": None,
                      "halted_today": False, "halted_dd": False, "trades": {}}
        if state_path and os.path.exists(state_path):
            with open(state_path) as f:
                self.state.update(json.load(f))

    # ---- persistence -------------------------------------------------
    def save(self):
        if not self.state_path:
            return
        tmp = self.state_path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.state, f, indent=2)
        os.replace(tmp, self.state_path)

    # ---- account limits ---------------------------------------------
    def update(self, account, now: float):
        s = self.state
        day = trading_day(now)
        if s["day"] != day:
            s.update(day=day, day_start_nav=account.nav, halted_today=False)
        s["peak_nav"] = max(s["peak_nav"] or account.nav, account.nav)
        if account.nav <= s["day_start_nav"] * (1 - self.p["daily_loss_limit_pct"] / 100):
            s["halted_today"] = True
        if account.nav <= s["peak_nav"] * (1 - self.p["max_drawdown_pct"] / 100):
            s["halted_dd"] = True
        self.save()

    @property
    def halted(self):
        if self.state["halted_dd"]:
            return "max drawdown hit - bot halted until you reset it"
        if self.state["halted_today"]:
            return "daily loss limit hit - no new trades until 17:00 New York"
        return None

    # ---- per-trade checks -------------------------------------------
    def can_open(self, signal, open_trades, price):
        if self.halted:
            return False, self.halted
        if len(open_trades) >= self.p["max_open_trades"]:
            return False, "max open trades"
        same = [t for t in open_trades if t.instrument == signal.instrument]
        if len(same) >= self.p["max_trades_per_instrument"]:
            return False, "already in this instrument"
        for cur in _currencies(signal.instrument):
            n = sum(1 for t in open_trades if cur in _currencies(t.instrument))
            if n >= self.p["max_trades_per_currency"]:
                return False, f"too much {cur} exposure"
        if not price.tradeable:
            return False, "market closed / not tradeable"
        if price.spread > self.p["max_spread_to_stop"] * signal.stop_distance:
            return False, "spread too wide for this stop"
        return True, "ok"

    def size(self, balance, stop_distance, quote_to_home, instrument):
        """Units so that a stop-out loses at most risk_per_trade_pct of balance."""
        if stop_distance <= 0 or quote_to_home <= 0:
            return 0
        risk_cash = balance * self.p["risk_per_trade_pct"] / 100
        loss_per_unit = stop_distance * quote_to_home
        step = 10 ** (-instrument.units_precision)
        units = math.floor(risk_cash / loss_per_unit / step) * step
        units = round(units, max(instrument.units_precision, 0))
        return units if units >= instrument.min_units else 0

    # ---- remember initial risk per trade (for breakeven / trailing) --
    def remember(self, trade_id, entry, stop, atr):
        self.state["trades"][str(trade_id)] = {"entry": entry, "stop": stop, "atr": atr}
        self.save()

    def forget_closed(self, open_ids):
        keep = {str(i) for i in open_ids}
        self.state["trades"] = {k: v for k, v in self.state["trades"].items() if k in keep}
        self.save()
