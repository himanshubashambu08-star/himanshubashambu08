"""The 24/5 loop.

Every `board_refresh_seconds`: read every chart (dashboard shows signal / forming / watch / none).
Every new entry-timeframe candle: look for signals -> learned filters -> US-session filter
-> risk checks -> size -> bracket order. Every tick: manage open trades (breakeven, trailing).
Every trading day at 17:00 New York: the learner reviews mistakes and improves itself.
"""
import logging
import os
import threading
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from . import strategy
from .journal import Journal
from .learner import Learner
from .models import GRANULARITY_SECONDS
from .risk import RiskManager, trading_day

log = logging.getLogger("bot")
NY = ZoneInfo("America/New_York")

DEFAULTS = {
    "instruments": ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "AUD_USD", "NZD_USD", "USD_CHF",
                    "EUR_JPY", "GBP_JPY", "EUR_GBP", "XAU_USD"],
    "instrument_types": ["CURRENCY"],            # used when instruments == "ALL"
    "entry_timeframe": "H1",
    "trend_timeframe": "H4",
    "candles": 300,
    "scan_delay_seconds": 15,
    "poll_seconds": 20,
    "board_refresh_seconds": 60,
    "entry_sessions_ny": [["08:00", "16:00"]],   # only open trades in the New York (US) session; [] = any time
    "breakeven_at_r": 1.0,
    "trail_start_r": 1.5,
    "trail_atr_mult": 1.0,
    "blackout_utc": [],
    "kill_file": "STOP",
    "learn": True,
}


class Engine:
    def __init__(self, broker, config, state_path=None, journal_path=None, memory_path=":memory:",
                 clock=time.time):
        self.broker = broker
        self.cfg = {**DEFAULTS, **config.get("engine", {})}
        self.base_params = config.get("strategy", {})
        self.risk = RiskManager(config.get("risk", {}), state_path)
        self.journal = Journal(journal_path)
        self.learner = Learner(config.get("learning", {}), memory_path, clock=clock)
        self.clock = clock
        self.last_bucket = None
        self.last_board = 0.0
        self._universe = None
        self.lock = threading.Lock()
        self.board = {}            # instrument -> chart reading
        self.status = {}
        self.known_trades = {}     # trade id -> instrument, for spotting closes

    # ---- settings the learner may have improved ------------------------
    def params(self):
        learned = dict(self.learner.params())
        learned.pop("reward_risk", None)
        return {**self.base_params, **learned}

    def reward_risk(self):
        return self.learner.params().get("reward_risk", self.risk.p["reward_risk"])

    # ---- universe ----------------------------------------------------
    def universe(self):
        if self._universe is None:
            want = self.cfg["instruments"]
            all_ = {i.name: i for i in self.broker.instruments()}
            if want == "ALL":
                self._universe = [i for i in all_.values() if i.type in self.cfg["instrument_types"]]
            else:
                self._universe = [all_[n] for n in want if n in all_]
            log.info("watching %d charts", len(self._universe))
        return self._universe

    # ---- sessions -------------------------------------------------------
    def in_session(self, now):
        sessions = self.cfg["entry_sessions_ny"]
        if not sessions:
            return True
        ny = datetime.fromtimestamp(now, timezone.utc).astimezone(NY)
        if ny.weekday() >= 5:
            return False
        hm = ny.strftime("%H:%M")
        return any(a <= hm < b for a, b in sessions)

    def _in_blackout(self, now):
        for start, end in self.cfg["blackout_utc"]:
            s = datetime.fromisoformat(start).replace(tzinfo=timezone.utc).timestamp()
            e = datetime.fromisoformat(end).replace(tzinfo=timezone.utc).timestamp()
            if s <= now <= e:
                return True
        return False

    # ---- one pass of the loop ----------------------------------------
    def tick(self):
        now = self.clock()
        prev_day = self.risk.state.get("day")
        account = self.broker.account()
        self.risk.update(account, now)
        trades = self.broker.open_trades()
        self._spot_closed(trades)
        self.risk.forget_closed([t.id for t in trades])
        self.manage(trades)

        tf = GRANULARITY_SECONDS[self.cfg["entry_timeframe"]]
        bucket = int((now - self.cfg["scan_delay_seconds"]) // tf)
        new_candle = bucket != self.last_bucket
        if new_candle or now - self.last_board >= self.cfg["board_refresh_seconds"]:
            self.refresh(account, trades, now, look_for_trades=new_candle)
            self.last_board = now
            self.last_bucket = bucket

        if self.cfg["learn"] and prev_day and prev_day != self.risk.state["day"] \
                and self.learner.get("last_review_day") != prev_day:
            self.review(prev_day)

    def why_no_new_trades(self, now):
        if self.risk.halted:
            return self.risk.halted
        if os.path.exists(self.cfg["kill_file"]):
            return "kill file present"
        if self._in_blackout(now):
            return "news blackout"
        if not self.in_session(now):
            return "outside US session"
        return None

    # ---- read every chart; trade on a new candle ------------------------
    def refresh(self, account, trades, now, look_for_trades):
        n, params = self.cfg["candles"], self.params()
        tf_s = GRANULARITY_SECONDS[self.cfg["entry_timeframe"]]
        board, signals = {}, []
        for inst in self.universe():
            try:
                ltf = self.broker.candles(inst.name, self.cfg["entry_timeframe"], n)
                htf = self.broker.candles(inst.name, self.cfg["trend_timeframe"], n)
                board[inst.name] = strategy.read_chart(inst.name, htf, ltf, params)
                if look_for_trades:
                    if self.cfg["learn"]:
                        self.learner.resolve(inst.name, ltf, tf_s, self.reward_risk(), self.cfg["breakeven_at_r"])
                    sig = strategy.evaluate(inst.name, htf, ltf, params)
                    if sig:
                        signals.append((inst, sig))
            except Exception as e:   # one bad chart must not stop the rest
                log.error("chart %s failed: %s", inst.name, e)
        blocked_now = self.why_no_new_trades(now)
        for inst, sig in signals:
            self.try_open(inst, sig, account, blocked_now)
            reading = board.get(inst.name)
            if reading and reading["state"] == "signal":
                reading["decision"] = self.journal.rows[-1]["event"] if self.journal.rows else None
                reading["decision_reason"] = self.journal.rows[-1].get("reason") if self.journal.rows else None
        with self.lock:
            self.board = board
            self.status = {
                "time": now, "nav": account.nav, "balance": account.balance, "currency": account.currency,
                "day_start_nav": self.risk.state.get("day_start_nav"),
                "open_trades": [t.__dict__ for t in self.broker.open_trades()],
                "no_new_trades": self.why_no_new_trades(now),
                "in_session": self.in_session(now),
                "params": params, "reward_risk": self.reward_risk(),
            }
        if look_for_trades:
            log.info("scan: %d charts, %d signals", len(board), len(signals))

    def try_open(self, inst, sig, account, blocked_now=None):
        try:
            price = self.broker.price(inst.name)
            sig.features["spread_ratio"] = round(price.spread / sig.stop_distance, 4)
            reason = blocked_now or (self.learner.blocked(sig) if self.cfg["learn"] else None)
            ok = reason is None
            if ok:
                ok, why = self.risk.can_open(sig, self.broker.open_trades(), price)
                reason = None if ok else why
            units = 0
            if ok:
                units = self.risk.size(account.balance, sig.stop_distance,
                                       self.broker.quote_to_home(inst.name), inst)
                if units <= 0:
                    ok, reason = False, "size is 0 (stop too wide)"
            if not ok:
                self.journal.write("skip", inst.name, sig.side, reason=reason, note=sig.reason)
                if self.cfg["learn"]:
                    self.learner.record_signal(sig, taken=False, skip_reason=reason)
                return None
            rr = self.reward_risk()
            entry = price.ask if sig.side > 0 else price.bid
            stop = entry - sig.side * sig.stop_distance
            tp = entry + sig.side * rr * sig.stop_distance
            trade = self.broker.market_order(inst.name, sig.side * units, stop, tp)
            self.risk.remember(trade.id, trade.entry, stop, sig.atr)
            self.known_trades[str(trade.id)] = inst.name
            if self.cfg["learn"]:
                self.learner.record_signal(sig, taken=True, trade_id=trade.id, entry=trade.entry)
            self.journal.write("open", inst.name, sig.side, units=units, entry=trade.entry,
                               stop=stop, tp=tp, note=sig.reason)
            log.info("OPEN %s %s units=%s entry=%s sl=%s tp=%s", inst.name,
                     "BUY" if sig.side > 0 else "SELL", units, trade.entry, stop, tp)
            return trade
        except Exception as e:
            log.error("order %s failed: %s", inst.name, e)
            self.journal.write("error", inst.name, sig.side, reason=str(e))
            return None

    def _spot_closed(self, open_trades):
        """When a bot trade disappears, store its real result for the learner."""
        open_ids = {str(t.id) for t in open_trades}
        for tid in [t for t in self.known_trades if t not in open_ids]:
            inst = self.known_trades.pop(tid)
            info = self.risk.state["trades"].get(tid)
            try:
                px = self.broker.closed_price(tid)
            except Exception as e:
                log.error("closed price %s: %s", tid, e)
                px = None
            if info and px is not None:
                risk = abs(info["entry"] - info["stop"])
                side = 1 if info["stop"] < info["entry"] else -1
                r = (px - info["entry"]) * side / risk if risk else 0.0
                self.learner.set_real_result(tid, r)
                self.journal.write("close", inst, side, entry=info["entry"], note=f"{r:+.2f}R exit {px}")
                log.info("CLOSED %s %s %+.2fR", inst, tid, r)

    # ---- managing open trades: breakeven + trailing stop -------------
    def manage(self, trades):
        for t in trades:
            info = self.risk.state["trades"].get(str(t.id))
            if not info:
                continue  # opened by hand: leave it alone
            try:
                price = self.broker.price(t.instrument)
            except Exception as e:
                log.error("price %s failed: %s", t.instrument, e)
                continue
            now_px = price.bid if t.side > 0 else price.ask
            r = abs(info["entry"] - info["stop"])
            if r <= 0:
                continue
            progress = (now_px - info["entry"]) * t.side / r
            new_stop = None
            if progress >= self.cfg["trail_start_r"]:
                new_stop = now_px - t.side * self.cfg["trail_atr_mult"] * info["atr"]
            if progress >= self.cfg["breakeven_at_r"]:
                be = info["entry"]
                new_stop = be if new_stop is None else (max(new_stop, be) if t.side > 0 else min(new_stop, be))
            current = t.stop if t.stop is not None else info["stop"]
            if new_stop is not None and (new_stop - current) * t.side > 1e-12:
                try:
                    self.broker.modify_stop(t.id, new_stop, instrument=t.instrument)
                    self.journal.write("move_sl", t.instrument, t.side, stop=new_stop, note=f"+{progress:.2f}R")
                    log.info("SL %s %s -> %s (+%.2fR)", t.instrument, t.id, new_stop, progress)
                except Exception as e:
                    log.error("move SL %s failed: %s", t.id, e)

    # ---- daily self-review -------------------------------------------
    def review(self, day):
        log.info("daily review for %s", day)
        n = self.learner.p["tune_bars"]

        def history(name):
            return (self.broker.candles(name, self.cfg["trend_timeframe"], n),
                    self.broker.candles(name, self.cfg["entry_timeframe"], n))
        try:
            out = self.learner.daily_review(day, history, self.params(), self.reward_risk(),
                                            [i.name for i in self.universe()], self.cfg["breakeven_at_r"])
            log.info("review done: %s", out)
        except Exception as e:
            log.exception("review failed: %s", e)

    # ---- dashboard -----------------------------------------------------
    def snapshot(self):
        with self.lock:
            charts = sorted(self.board.values(), key=lambda r: -r.get("score", 0))
            status = dict(self.status)
        return {"status": status, "charts": charts, "learning": self.learner.snapshot(),
                "journal": self.journal.rows[-30:][::-1]}

    def run_forever(self):
        log.info("bot started")
        while True:
            try:
                self.tick()
            except Exception as e:
                log.exception("tick failed: %s", e)
            time.sleep(self.cfg["poll_seconds"])
