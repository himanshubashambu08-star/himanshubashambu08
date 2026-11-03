"""The 24/5 loop: scan -> check rules -> size -> place bracket order -> manage open trades."""
import logging
import os
import time

from . import strategy
from .journal import Journal
from .models import GRANULARITY_SECONDS
from .risk import RiskManager

log = logging.getLogger("bot")

DEFAULTS = {
    "instruments": ["XAU_USD", "EUR_USD", "GBP_USD", "USD_JPY"],
    "instrument_types": ["CURRENCY", "METAL"],   # used when instruments == "ALL"
    "entry_timeframe": "H1",
    "trend_timeframe": "H4",
    "candles": 300,
    "scan_delay_seconds": 15,        # wait after candle close so the broker has finished it
    "poll_seconds": 20,
    "breakeven_at_r": 1.0,           # move stop to entry once +1R
    "trail_start_r": 1.5,            # start trailing once +1.5R
    "trail_atr_mult": 1.0,
    "blackout_utc": [],              # e.g. [["2026-11-06T13:25", "2026-11-06T13:45"]] around NFP
    "kill_file": "STOP",             # create this file -> no NEW trades (open ones still managed)
}


class Engine:
    def __init__(self, broker, config, state_path=None, journal_path=None, clock=time.time):
        self.broker = broker
        self.cfg = {**DEFAULTS, **config.get("engine", {})}
        self.strategy_params = config.get("strategy", {})
        self.risk = RiskManager(config.get("risk", {}), state_path)
        self.journal = Journal(journal_path)
        self.clock = clock
        self.last_bucket = None
        self._universe = None

    # ---- universe ----------------------------------------------------
    def universe(self):
        if self._universe is None:
            want = self.cfg["instruments"]
            all_ = {i.name: i for i in self.broker.instruments()}
            if want == "ALL":
                self._universe = [i for i in all_.values() if i.type in self.cfg["instrument_types"]]
            else:
                self._universe = [all_[n] for n in want if n in all_]
            log.info("scanning %d instruments", len(self._universe))
        return self._universe

    # ---- one pass of the loop ----------------------------------------
    def tick(self):
        now = self.clock()
        account = self.broker.account()
        self.risk.update(account, now)
        trades = self.broker.open_trades()
        self.risk.forget_closed([t.id for t in trades])
        self.manage(trades)

        tf = GRANULARITY_SECONDS[self.cfg["entry_timeframe"]]
        bucket = int((now - self.cfg["scan_delay_seconds"]) // tf)
        if bucket == self.last_bucket:
            return
        self.last_bucket = bucket

        if self.risk.halted:
            log.warning("no new trades: %s", self.risk.halted)
            return
        if os.path.exists(self.cfg["kill_file"]):
            log.warning("kill file present: no new trades")
            return
        if self._in_blackout(now):
            log.info("news blackout: no new trades")
            return
        self.scan(account)

    def _in_blackout(self, now):
        from datetime import datetime, timezone
        for start, end in self.cfg["blackout_utc"]:
            s = datetime.fromisoformat(start).replace(tzinfo=timezone.utc).timestamp()
            e = datetime.fromisoformat(end).replace(tzinfo=timezone.utc).timestamp()
            if s <= now <= e:
                return True
        return False

    # ---- scanning ----------------------------------------------------
    def scan(self, account):
        n = self.cfg["candles"]
        signals = []
        for inst in self.universe():
            try:
                ltf = self.broker.candles(inst.name, self.cfg["entry_timeframe"], n)
                htf = self.broker.candles(inst.name, self.cfg["trend_timeframe"], n)
                sig = strategy.evaluate(inst.name, htf, ltf, self.strategy_params)
            except Exception as e:  # one bad instrument must not stop the scan
                log.error("scan %s failed: %s", inst.name, e)
                continue
            if sig:
                signals.append((inst, sig))
        log.info("scan done: %d signals", len(signals))
        for inst, sig in signals:
            self.try_open(inst, sig, account)

    def try_open(self, inst, sig, account):
        try:
            price = self.broker.price(inst.name)
            ok, why = self.risk.can_open(sig, self.broker.open_trades(), price)
            if not ok:
                self.journal.write("skip", inst.name, sig.side, reason=why, note=sig.reason)
                return None
            units = self.risk.size(account.balance, sig.stop_distance,
                                   self.broker.quote_to_home(inst.name), inst)
            if units <= 0:
                self.journal.write("skip", inst.name, sig.side, reason="size is 0 (stop too wide)")
                return None
            entry = price.ask if sig.side > 0 else price.bid
            stop = entry - sig.side * sig.stop_distance
            tp = entry + sig.side * self.risk.p["reward_risk"] * sig.stop_distance
            trade = self.broker.market_order(inst.name, sig.side * units, stop, tp)
            # re-anchor risk on the real fill price
            self.risk.remember(trade.id, trade.entry, stop, sig.atr)
            self.journal.write("open", inst.name, sig.side, units=units, entry=trade.entry,
                               stop=stop, tp=tp, note=sig.reason)
            log.info("OPEN %s %s units=%s entry=%s sl=%s tp=%s", inst.name,
                     "BUY" if sig.side > 0 else "SELL", units, trade.entry, stop, tp)
            return trade
        except Exception as e:
            log.error("order %s failed: %s", inst.name, e)
            self.journal.write("error", inst.name, sig.side, reason=str(e))
            return None

    # ---- managing open trades: breakeven + trailing stop -------------
    def manage(self, trades):
        for t in trades:
            info = self.risk.state["trades"].get(str(t.id))
            if not info:
                continue  # opened by hand or before the bot: leave it alone
            try:
                price = self.broker.price(t.instrument)
            except Exception as e:
                log.error("price %s failed: %s", t.instrument, e)
                continue
            now_px = price.bid if t.side > 0 else price.ask   # price we could exit at
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
                    self.journal.write("move_sl", t.instrument, t.side, stop=new_stop,
                                       note=f"+{progress:.2f}R")
                    log.info("SL %s %s -> %s (+%.2fR)", t.instrument, t.id, new_stop, progress)
                except Exception as e:
                    log.error("move SL %s failed: %s", t.id, e)

    def run_forever(self):
        log.info("bot started")
        while True:
            try:
                self.tick()
            except Exception as e:
                log.exception("tick failed: %s", e)
            time.sleep(self.cfg["poll_seconds"])
