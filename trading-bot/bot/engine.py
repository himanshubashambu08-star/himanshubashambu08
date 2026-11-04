"""The 24/5 loop, split into named agents (see agents.py).

Every `board_refresh_seconds`: Chart Scanner fetches every chart, Chart Reader reads them.
Every new entry-timeframe candle: Rule Checker -> Entry Timer -> Risk Manager -> Order Executor.
Every tick: Exit Planner manages open trades, Budget Manager checks account limits.
Every trading day at 17:00 New York: Time Machine reviews mistakes and improves the rules.
"""
import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from . import ema_break, strategy
from .agents import AgentLog
from .journal import Journal
from .learner import Learner, MISTAKE_WORDS
from .models import GRANULARITY_SECONDS
from .news import NewsCalendar
from .brain import Brain
from . import VERSION, build as _git_build
import json
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
    "entry_sessions_by_type": {"CFD": [["09:30", "16:00"]]},   # US stock indices: only while Wall Street is open
    "breakeven_at_r": 1.0,
    "trail_start_r": 1.5,
    "trail_atr_mult": 1.0,
    "blackout_utc": [],
    "kill_file": "STOP",
    "learn": True,
    "strategy": "pullback",          # "pullback" (old H1/H4 rules) or "ema_break" (EMA 9/15 breakout)
    "gate_min_unseen_trades": 100,   # ema_break trades on demo only after the backtest passes on unseen data
    "gate_min_pf": 1.2,
    "backtest_days": 730,
    # shadow mode: scan everything, place demo orders only on the trading list
    "base_instrument": "XAU_USD",            # first trading-list entry (needs the main backtest gate)
    "base_window_ny": [["08:00", "12:00"]],
    "research_days": 365,                    # per instrument x hour backtest, all instruments
    "cell_min_unseen_trades": 30,            # an instrument+hour joins the list only with this many unseen trades
    "cell_min_unseen_pf": 1.2,
    "cell_min_tuning_pf": 1.1,               # ...and it must also be good on the older data (no luck picks)
    "auto_add_cells": True,
    # forward tests: rule variants followed live on the chart (shadow only, never traded)
    "forward_tests": [{"instrument": "XAU_USD", "timeframe": "H1", "reward_risk": 3.0}],
    "trade_mode": "all",                     # "all" = real demo order on every setup, every chart, every hour
                                             # "list" = only the tested trading list, everything else shadow
}


def pair(name):
    return name.replace("_", "/")


def side_word(side):
    return "BUY" if side > 0 else "SELL"


def ny_time(ts):
    return datetime.fromtimestamp(ts, timezone.utc).astimezone(NY).strftime("%H:%M")


# the 28 main forex pairs/crosses + gold, silver and the US indices: tight spreads, deep markets
LIQUID = {"EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "USD_CAD", "AUD_USD", "NZD_USD", "EUR_GBP", "EUR_JPY",
          "GBP_JPY", "EUR_CHF", "EUR_AUD", "EUR_CAD", "AUD_JPY", "CAD_JPY", "CHF_JPY", "GBP_CHF", "GBP_AUD",
          "AUD_CAD", "AUD_NZD", "NZD_JPY", "GBP_CAD", "EUR_NZD", "GBP_NZD", "AUD_CHF", "CAD_CHF", "NZD_CAD",
          "NZD_CHF", "XAU_USD", "XAG_USD", "NAS100_USD", "SPX500_USD", "US30_USD"}


def pf_of(card):
    """Profit factor for comparisons: no losing trade at all counts as infinite, no trades as 0."""
    if not card or not card.get("n"):
        return 0.0
    return float("inf") if card.get("pf") is None and card.get("total_r", 0) > 0 else (card.get("pf") or 0.0)


def pf(v):
    """Readable price: 1.08423 / 151.234 / 2,415.20 / 621,310.50 (never 6.2e+05)."""
    a = abs(v)
    return f"{v:.5f}" if a < 20 else f"{v:.3f}" if a < 1000 else f"{v:,.2f}"


def hinglish_reason(reason):
    r = str(reason)
    fixed = {
        "outside US session": "US session band hai (sirf 08:00–16:00 New York mein entry)",
        "max open trades": "Pehle se max open trades chal rahe hain",
        "already in this instrument": "Is pair mein pehle se trade open hai",
        "market closed / not tradeable": "Market band hai / abhi trade nahi ho sakta",
        "spread too wide for this stop": "Spread SL ke hisaab se bahut zyada hai",
        "news blackout": "News ka time hai (blackout)",
    }
    if r in fixed:
        return fixed[r]
    if r.startswith("opposite ") and " bet vs open " in r:
        cur, other = r[9:].split(" bet vs open ")
        return (f"Ulta daav: {other.replace('_', '/')} wala open trade {cur} pe ulti side hai. Dono saath liye to ek "
                f"doosre ko kaat denge, isliye nahi liya")
    if r.startswith("same bet as open "):
        other, c = r[17:].split(" (corr ")
        return f"Double daav: yeh pair {other.replace('_', '/')} jaisa hi chalta hai (mel {c[:-1]}), wahi trade pehle se open hai"
    if r.startswith("cancels open "):
        other, c = r[13:].split(" (corr ")
        return (f"Ulta daav: yeh pair {other.replace('_', '/')} ke ulta chalta hai (mel {c[:-1]}), yeh trade us open "
                f"trade ko kaat deta")
    if r.startswith("correlated with open "):
        return f"{r[21:].replace('_', '/')} pehle se open hai, aur yeh pair uske saath hi chalta hai (double risk se bachne ke liye)"
    if r.startswith("too much ") and r.endswith(" exposure"):
        return f"{r[9:-9]} mein pehle se kaafi trades hain (ek currency pe zyada risk nahi)"
    if r == "shadow":
        return ("Shadow: yeh pair/ghanta abhi trading list mein nahi. Sirf record ho raha hai, "
                "Time Machine chart pe dekhega ki SL lagta ya TP")
    if r == "backtest gate":
        return ("Backtest gate: nayi strategy ka backtest abhi unseen data pe pass nahi hua "
                "(PF 1.2+ aur 100+ trades chahiye), isliye demo pe bhi trade nahi")
    if r == "max trades today":
        return "Aaj ke max trades ho gaye (din mein 2)"
    if r.startswith("daily limit incl open risk"):
        return "Daily loss limit: aaj ka nuksaan + open trades ka risk + yeh trade limit se zyada ho jata"
    if r == "liquid only":
        return "Sirf bade pairs mode: yeh chhota/exotic pair hai, trade nahi lega (sirf data ke liye follow hoga)"
    if r.startswith("news: "):
        return "Bada news aa raha hai: " + r[6:] + " · 15 min pehle se 15 min baad tak naya trade nahi"
    if r.startswith("learned filter: avoid "):
        return "Seekha hua rule: " + r[len("learned filter: avoid "):] + " se bachna hai"
    if r.startswith("daily loss limit"):
        return "Aaj ki loss limit poori ho gayi, 17:00 New York tak naye trades nahi"
    if r.startswith("max drawdown"):
        return "Max drawdown lag gaya, bot ruka hai jab tak aap reset na karo"
    return r


def ref_for(instrument, signal_time):
    return f"{instrument}@{int(signal_time)}"


class Engine:
    def __init__(self, broker, config, state_path=None, journal_path=None, memory_path=":memory:",
                 agents_path=None, news_path=None, news_fetcher=None, brain_path=None, seen_path=None,
                 brain_client=None, clock=time.time):
        self.broker = broker
        self.cfg = {**DEFAULTS, **config.get("engine", {})}
        self.base_params = config.get("strategy", {})
        self.risk = RiskManager(config.get("risk", {}), state_path)
        self.journal = Journal(journal_path)
        self.learner = Learner(config.get("learning", {}), memory_path, clock=clock)
        self.agents = AgentLog(agents_path, clock=clock)
        self.news = NewsCalendar(config.get("news", {}), news_path, clock=clock, fetcher=news_fetcher)
        self._news_active = set()
        self._build = _git_build()
        self._closes = {}          # instrument -> recent closed H1 closes, for correlation
        self.brain = Brain(config.get("brain", {}), self.brain_context, brain_path, clock=clock, client=brain_client)
        self.seen_path = seen_path
        self.seen = []
        if seen_path and os.path.exists(seen_path):
            try:
                with open(seen_path) as f:
                    self.seen = json.load(f)
            except Exception:
                self.seen = []
        self.clock = clock
        self.last_bucket = None
        self.last_board = 0.0
        self._universe = None
        self.lock = threading.Lock()
        self.board = {}
        self.status = {}
        self.known_trades = {}
        self._was_halted = None

    # ---- settings the learner may have improved ------------------------
    def params(self):
        learned = dict(self.learner.params())
        learned.pop("reward_risk", None)
        return {**self.base_params, **learned}

    @property
    def ema(self):
        return self.cfg["strategy"] == "ema_break"

    def ema_params(self):
        return {**ema_break.DEFAULTS, **self.base_params,
                "window_ny": self.cfg["base_window_ny"] or ema_break.DEFAULTS["window_ny"]}

    def trade_allowed(self, inst_name, now):
        """trade_mode "all": every setup is traded. "list": only the trading list, everything else is shadow."""
        if self.cfg["trade_mode"] == "all":
            return True
        if inst_name == self.cfg["base_instrument"] and self.gate() and ema_break.in_window(now, self.cfg["base_window_ny"]):
            return True
        if not self.cfg["auto_add_cells"]:
            return False
        hour = datetime.fromtimestamp(now, timezone.utc).astimezone(NY).hour
        return any(c["instrument"] == inst_name and c["hour"] == hour for c in self.learner.get("trade_list", [])) \
            and ema_break.in_window(now, ema_break.ALL_DAY)

    def reward_risk(self):
        if self.ema:
            return self.ema_params()["reward_risk"]
        return self.learner.params().get("reward_risk", self.risk.p["reward_risk"])

    def gate(self):
        g = self.learner.get("gate") or {}
        return bool(g.get("passed"))

    def universe(self):
        if self._universe is None:
            want = self.cfg["instruments"]
            all_ = {i.name: i for i in self.broker.instruments()}
            if want == "ALL":
                want = [f"ALL:{t}" for t in self.cfg["instrument_types"]]
            picked = {}
            for n in want:                      # "ALL:CURRENCY" / "ALL:METAL" = every such instrument on the account
                if n.startswith("ALL:"):
                    for i in sorted(all_.values(), key=lambda i: i.name):
                        if i.type == n[4:]:
                            picked[i.name] = i
                elif n in all_:
                    picked[n] = all_[n]
                else:
                    log.warning("%s is not available on this account, skipped", n)
            self._universe = list(picked.values())
            log.info("watching %d charts", len(self._universe))
        return self._universe

    # ---- sessions -------------------------------------------------------
    def _inst(self, inst):
        if inst is None or hasattr(inst, "type"):
            return inst
        return next((i for i in self.universe() if i.name == inst), None)

    def in_session(self, now, inst=None):
        inst = self._inst(inst)
        sessions = self.cfg["entry_sessions_by_type"].get(inst.type, self.cfg["entry_sessions_ny"]) \
            if inst is not None else self.cfg["entry_sessions_ny"]
        if not sessions:
            return True
        ny = datetime.fromtimestamp(now, timezone.utc).astimezone(NY)
        if ny.weekday() >= 5:
            return False
        hm = ny.strftime("%H:%M")
        return any(a <= hm < b for a, b in sessions)

    def session_text(self, now):
        sessions = self.cfg["entry_sessions_ny"]
        if not sessions:
            return "Entry window: koi time limit nahi"
        win = ", ".join(f"{a}–{b}" for a, b in sessions)
        if self.in_session(now):
            return f"Entry window khuli hai ({win} New York)"
        return f"Entry window band hai. Khulegi: {win} New York (Mon–Fri)"

    def _in_blackout(self, now):
        for start, end in self.cfg["blackout_utc"]:
            s = datetime.fromisoformat(start).replace(tzinfo=timezone.utc).timestamp()
            e = datetime.fromisoformat(end).replace(tzinfo=timezone.utc).timestamp()
            if s <= now <= e:
                return True
        return False

    def why_no_new_trades(self, now, inst=None):
        if self.risk.halted:
            return self.risk.halted
        if os.path.exists(self.cfg["kill_file"]):
            return "STOP switch ON (kill file)"
        if self._in_blackout(now):
            return "news blackout"
        if not self.in_session(now, inst):
            return "outside US session"
        return None

    # ---- one pass of the loop ----------------------------------------
    def tick(self):
        now = self.clock()
        prev_day = self.risk.state.get("day")
        account = self.broker.account()
        self.risk.update(account, now)
        self.agents.set_day(self.risk.state["day"])
        self.report_budget(account)
        self.report_news(now)
        trades = self.broker.open_trades()
        self._spot_closed(trades)
        self.recover_untracked(trades)
        if self.status:                       # keep the open-trades list fresh every tick, not only every minute
            try:
                view = self.open_trades_view()
                with self.lock:
                    self.status["open_trades"] = view
            except Exception as e:
                log.error("open trades view: %s", e)
        self.manage(trades)
        self.check_pending()
        if self.ema:
            try:
                self.forward_tick(now)
            except Exception as e:
                log.exception("forward test: %s", e)

        tf = GRANULARITY_SECONDS[self.cfg["entry_timeframe"]]
        bucket = int((now - self.cfg["scan_delay_seconds"]) // tf)
        if self.last_bucket is None:
            self.last_bucket = self.risk.state.get("last_bucket")   # after a restart, never rescan the same candle
        new_candle = bucket != self.last_bucket
        if new_candle or now - self.last_board >= self.cfg["board_refresh_seconds"]:
            try:
                self.refresh(account, trades, now, look_for_trades=new_candle)
            except Exception as e:           # never let one bad chart or label stop trading and the backtests
                log.exception("refresh failed: %s", e)
                self.agents.did("scanner", f"Scan mein error: {e}", tone="bad")
            self.last_board = now
            if new_candle:
                self.risk.state["last_bucket"] = bucket
                self.risk.save()
            self.last_bucket = bucket

        if self.cfg["learn"] and prev_day and prev_day != self.risk.state["day"] \
                and self.learner.get("last_review_day") != prev_day and not getattr(self, "_reviewing", False):
            # minutes of history downloads: run beside the loop so open trades keep being managed
            self._reviewing = True

            def run(day=prev_day):
                try:
                    self.review(day)
                finally:
                    self._reviewing = False
            if getattr(self, "background_review", True):
                threading.Thread(target=run, daemon=True).start()
            else:
                run()
        self.brain.maybe_brief(now, self._brief_done)
        need = ((self.learner.get("ema_backtest") or {}).get("rules") != self.ema_params()
                or not self.learner.get("research")
                or {r["rr"] for r in (self.learner.get("variations") or {}).get("rows", [])} != set(self.VARIATION_RRS)) if self.ema \
            else not self.learner.get("experiments")
        if self.cfg["learn"] and not getattr(self, "_validated_once", False) and need:
            self._validated_once = True
            threading.Thread(target=self.validate_setup, args=(self.risk.state["day"],), daemon=True).start()
        self.agents.save()

    # ---- Budget Manager ----------------------------------------------------
    def report_budget(self, account):
        s, p = self.risk.state, self.risk.p
        start = s.get("day_start_nav") or account.nav
        pl = account.nav - start
        limit = start * p["daily_loss_limit_pct"] / 100
        left = max(0.0, limit + min(pl, 0))
        peak = s.get("peak_nav") or account.nav
        floor = peak * (1 - p["max_drawdown_pct"] / 100)
        room = account.nav - floor
        ccy = account.currency
        halted = self.risk.halted
        tone = "bad" if halted else ("warn" if left < limit * 0.5 else "ok")
        self.agents.status("budget", f"Aaj {pl:+,.0f} {ccy} · daily loss bacha {left:,.0f} {ccy}"
                           + (f" · {halted}" if halted else ""), tone)
        risk_next = account.balance * p["risk_per_trade_pct"] / 100
        self.agents.plan("budget", f"Agle trade pe max risk {risk_next:,.0f} {ccy} ({p['risk_per_trade_pct']}%). "
                         f"Drawdown floor {floor:,.0f} {ccy} se {room:,.0f} {ccy} upar.")
        if halted != self._was_halted and self._was_halted is not None:
            if halted:
                self.agents.did("budget", f"Naye trades band: {halted}", tone="bad")
                self.agents.handoff("budget", "timer", "Entry Timer ko bola: aaj aur trade nahi")
            else:
                self.agents.did("budget", "Naya trading din: limits reset, trades phir allowed", tone="good")
        self._was_halted = halted

    # ---- Scanner + Reader + Rules ----------------------------------------
    def refresh(self, account, trades, now, look_for_trades):
        n, params = self.cfg["candles"], self.params()
        tf_name = self.cfg["entry_timeframe"]
        tf_s = GRANULARITY_SECONDS[tf_name]
        board, signals, failed = {}, [], []
        uni = self.universe()
        with self.lock:                      # account numbers right away, even while the scan is running
            self.status.update({"time": now, "nav": account.nav, "balance": account.balance,
                                "currency": account.currency, "day_start_nav": self.risk.state.get("day_start_nav"),
                                "risk": dict(self.risk.p)})
        self.scan_progress = {"done": 0, "total": len(uni), "started": now, "running": True}
        for k, inst in enumerate(uni):
            self.scan_progress["done"] = k
            if k and k % 10 == 0:
                with self.lock:
                    self.board = {**self.board, **board}       # charts appear on the dashboard as they are read
            try:
                ltf = self.broker.candles(inst.name, tf_name, n)
                if self.ema:
                    board[inst.name] = ema_break.read_chart(inst.name, ltf, self.ema_params())
                else:
                    htf = self.broker.candles(inst.name, self.cfg["trend_timeframe"], n)
                    board[inst.name] = strategy.read_chart(inst.name, htf, ltf, params)
                self._closes[inst.name] = [c.c for c in ltf if c.complete][-201:]
                if look_for_trades:
                    if self.cfg["learn"] and not self.ema:
                        self.learner.resolve(inst.name, ltf, tf_s, self.reward_risk(), self.cfg["breakeven_at_r"])
                        self.report_resolved()
                    elif self.cfg["learn"]:
                        self.learner.resolve_ema(inst.name, ltf, tf_s, self.reward_risk())
                        self.report_resolved()
                    sig = (ema_break.evaluate(inst.name, ltf, self.ema_params()) if self.ema
                           else strategy.evaluate(inst.name, htf, ltf, params))
                    if sig:
                        signals.append((inst, sig))
            except Exception as e:
                failed.append(inst.name)
                log.error("chart %s failed: %s", inst.name, e)

        A = self.agents
        next_scan = (int(now // tf_s) + 1) * tf_s + self.cfg["scan_delay_seconds"]
        A.status("scanner", f"{len(board)} charts live" + (f" · {len(failed)} fail" if failed else ""),
                 "warn" if failed else "ok")
        A.plan("scanner", f"Har {self.cfg['board_refresh_seconds']}s charts refresh. Agla full scan "
               f"({tf_name} candle close) {ny_time(next_scan)} New York pe.")
        states = {}
        for r in board.values():
            states[r["state"]] = states.get(r["state"], 0) + 1
        A.status("reader", f"{states.get('signal', 0)} signal · {states.get('forming', 0)} ban rahe · "
                 f"{states.get('watch', 0)} watch · {states.get('none', 0)} kuch nahi", "ok")
        forming = sorted([r for r in board.values() if r["state"] == "forming"], key=lambda r: -r["score"])
        A.plan("reader", "Nazar: " + "; ".join(
            f"{pair(r['instrument'])} {'buy' if r['bias'] > 0 else 'sell'}"
            + (f" zone {r['zone'][0]}–{r['zone'][1]}" if r.get("zone") else "")
            for r in forming[:4]) if forming else "Abhi koi setup banta nahi dikh raha. Har minute dobara padhega.")
        p = {**strategy.DEFAULTS, **params}
        ep = self.ema_params()
        if self.ema:
            A.plan("rules", f"Rules ({tf_name}): EMA{ep['ema_fast']} > EMA{ep['ema_slow']} = sirf BUY, neeche = sirf SELL · "
                   f"alert candle EMA ko touch na kare · agli candle high/low tode to entry · SL alert candle ka "
                   f"low/high · TP {ep['reward_risk']}R · SL {ep['min_stop_atr']}–{ep['max_stop_atr']}×ATR · "
                   + (f"max {ep['max_trades_per_day']} trade/din" if ep['max_trades_per_day'] else "din ki koi limit nahi")
                   + (" · HAR chart, HAR time pe asli trade" if self.cfg["trade_mode"] == "all" else " · asli trade sirf trading list pe"))
        else:
          A.plan("rules", f"Rules: H4 pe EMA{p['htf_ema_fast']}/{p['htf_ema_slow']} trend · H1 pe EMA"
               f"{p['ltf_ema_pullback']} tak pullback aur wapas close · RSI buy {p['rsi_buy_min']}–{p['rsi_buy_max']}, "
               f"sell {p['rsi_sell_min']}–{p['rsi_sell_max']} · SL {p['atr_stop_mult']}×ATR · TP {self.reward_risk()}R")

        if look_for_trades:
            A.count("scanner", "scans")
            A.count("scanner", "charts", len(board))
            A.did("scanner", f"Naya {tf_name} candle: {len(board)} charts scan kiye"
                  + (f", fail: {', '.join(map(pair, failed))}" if failed else ""))
            A.handoff("scanner", "reader", f"{len(board)} charts padhne ko diye", n=len(board))
            A.did("reader", f"Padha: {states.get('signal', 0)} signal, {states.get('forming', 0)} setup ban rahe, "
                  f"{states.get('watch', 0)} sirf trend, {states.get('none', 0)} bina trend")
            A.count("reader", "signals", len(signals))
            A.count("rules", "checked", len(board))
            if signals:
                A.handoff("reader", "rules", f"{len(signals)} signal check karne ko: "
                          + ", ".join(f"{pair(i.name)} {side_word(s.side)}" for i, s in signals), n=len(signals))
            else:
                A.did("rules", f"{len(board)} charts check kiye, kisi mein bhi saare rules poore nahi hue")
            A.status("rules", f"Aaj {A.agents['rules']['counts'].get('passed', 0) + len(signals)} signal pass "
                     f"kiye / {A.agents['rules']['counts'].get('checked', 0)} checks", "ok")

        blocked_now = self.why_no_new_trades(now)
        A.status("timer", self.session_text(now) if not blocked_now or blocked_now == "outside US session"
                 else f"Entry band: {blocked_now}", "ok" if not blocked_now else "warn")
        A.plan("timer", self.session_text(now) + (f". Active seekhe rules: {len(self.learner.filters())}"
                                                  if self.learner.filters() else ""))
        for inst, sig in signals:
            ref = ref_for(inst.name, sig.time)
            if ref in A.journeys and A.journeys[ref]["steps"]:
                continue                       # already handled this exact signal
            A.journey_start(ref, inst.name, sig.side, sig.time, sig.reason)
            f = sig.features
            A.step(ref, "scanner", "pass", f"{pair(inst.name)} ka {tf_name} candle {ny_time(sig.time + tf_s)} pe close hua")
            A.step(ref, "reader", "pass", "Chart pe signal dikha")
            if self.ema:
                A.step(ref, "rules", "pass", f"✓ EMA9 {'>' if sig.side > 0 else '<'} EMA15 · ✓ alert candle EMA se door · "
                       f"entry {pf(sig.entry_price)} tootne pe · SL {pf(sig.stop_price)} ({f.get('stop_atr')}×ATR)")
            else:
                A.step(ref, "rules", "pass", f"✓ H4 trend {'up' if sig.side > 0 else 'down'} · ✓ EMA pullback + rejection · "
                       f"✓ RSI {f.get('rsi')} · SL distance {pf(sig.stop_distance)}")
            A.count("rules", "passed")
            A.did("rules", f"{pair(inst.name)} {side_word(sig.side)}: saare rules poore", ref, "good")
            A.handoff("rules", "timer", f"{pair(inst.name)} {side_word(sig.side)} timing check ke liye", ref)
            self.try_open(inst, sig, account, self.why_no_new_trades(now, inst))
            reading = board.get(inst.name)
            j = A.journeys.get(ref)
            if reading and j:
                reading["decision"] = "open" if j["taken"] else "skip"
                reading["decision_reason"] = next((s["text"] for s in j["steps"] if s["verdict"] == "block"), None)
                reading["ref"] = ref

        rp, rc, ec = self.risk.p, A.agents["risk"]["counts"], A.agents["executor"]["counts"]
        tc = A.agents["timer"]["counts"]
        A.status("timer", A.agents["timer"]["status"].split(" · Aaj")[0]
                 + f" · Aaj {tc.get('go', 0)} GO, {tc.get('blocked', 0)} roke", A.agents["timer"]["tone"])
        A.status("risk", f"Aaj {rc.get('approved', 0)} approve · {rc.get('blocked', 0)} roke"
                 + (f" · {self.risk.halted}" if self.risk.halted else ""), "bad" if self.risk.halted else "ok")
        A.plan("risk", f"Har trade pe {rp['risk_per_trade_pct']}% risk · max {rp['max_open_trades']} open trades · "
               f"ek pair mein {rp['max_trades_per_instrument']} · ek currency mein max {rp['max_trades_per_currency']} · "
               f"spread SL ke {int(rp['max_spread_to_stop'] * 100)}% se kam · ek currency pe ulta daav nahi · "
               f"{int(rp['max_correlation'] * 100)}%+ saath/ulta chalne wale pairs mein ek hi trade · daily loss {rp['daily_loss_limit_pct']}% · "
               f"max drawdown {rp['max_drawdown_pct']}%")
        A.status("executor", f"Aaj {ec.get('orders', 0)} orders lage", "ok" if ec.get("orders") else "idle")
        A.plan("executor", "Risk Manager se approve hote hi market order, SL aur TP ek saath broker pe. "
               "Fail hua to dobara nahi bhejta (double order se bachne ke liye).")

        self.scan_progress = {"done": len(uni), "total": len(uni), "started": now, "running": False,
                              "finished": time.time(), "signals": len(signals), "failed": len(failed)}
        with self.lock:
            self.board = board
            self.status = {
                "time": now, "nav": account.nav, "balance": account.balance, "currency": account.currency,
                "day_start_nav": self.risk.state.get("day_start_nav"),
                "open_trades": self.open_trades_view(),
                "no_new_trades": self.why_no_new_trades(now),
                "in_session": self.in_session(now), "session_text": self.session_text(now),
                "params": params, "reward_risk": self.reward_risk(),
                "risk": dict(self.risk.p), "next_scan": next_scan,
                "timeframes": [tf_name, self.cfg["trend_timeframe"]],
            }
        if look_for_trades:
            log.info("scan: %d charts, %d signals", len(board), len(signals))

    # ---- Entry Timer -> Risk Manager -> Order Executor ---------------------
    def try_open(self, inst, sig, account, blocked_now=None):
        A, ref, name = self.agents, ref_for(inst.name, sig.time), pair(inst.name)
        try:
            price = self.broker.price(inst.name)
            sig.features["spread_ratio"] = round(price.spread / sig.stop_distance, 4)

            # Entry Timer
            if not blocked_now and self.learner.get("universe", "all") == "liquid" and inst.name not in LIQUID \
                    and not self.ema:
                blocked_now = "liquid only"
            if not blocked_now and self.ema:
                if not self.trade_allowed(inst.name, self.clock()):
                    blocked_now = "shadow"
                elif self.ema_params()["max_trades_per_day"] and \
                        self.trades_today() >= self.ema_params()["max_trades_per_day"]:
                    blocked_now = "max trades today"
            ev = None if blocked_now else self.news.blocking(inst.name, self.clock())
            reason = blocked_now or (f"news: {ev['currency']} {ev['title']} {ny_time(ev['time'])} NY (High)" if ev else None) \
                or (self.learner.blocked(sig) if self.cfg["learn"] and not self.ema else None)
            if reason:
                return self._skip(inst, sig, "timer", reason)
            A.step(ref, "timer", "pass", "GO: " + ("entry ka time khula" if self.cfg["entry_sessions_ny"] else "24 ghante mode") + ", news blackout nahi, koi seekha hua rule nahi roka")
            A.count("timer", "go")
            A.did("timer", f"{name} {side_word(sig.side)}: GO", ref, "good")
            A.handoff("timer", "risk", f"{name} size aur limits ke liye", ref)

            # Risk Manager
            conv = self.broker.quote_to_home(inst.name)
            new_risk = account.balance * self.risk.p["risk_per_trade_pct"] / 100
            lost = max(0.0, (self.risk.state.get("day_start_nav") or account.nav) - account.balance)
            ok, why = self.risk.can_open(sig, self.broker.open_trades(), price, corr=self.correlation,
                                         kinds={i.name: i.type for i in self.universe()},
                                         at_risk=(lost, self.open_risk(), new_risk))
            if not ok:
                return self._skip(inst, sig, "risk", why)
            units = self.risk.size(account.balance, sig.stop_distance, conv, inst)
            if units <= 0:
                return self._skip(inst, sig, "risk", "size 0 nikla (stop bahut door hai)")
            risk_cash = account.balance * self.risk.p["risk_per_trade_pct"] / 100
            A.step(ref, "risk", "pass", f"{units:g} units · max risk {risk_cash:,.0f} {account.currency} "
                   f"({self.risk.p['risk_per_trade_pct']}%) · spread theek")
            A.count("risk", "approved")
            A.did("risk", f"{name}: {units:g} units approve, risk {risk_cash:,.0f} {account.currency}", ref, "good")
            A.handoff("risk", "executor", f"{name} {side_word(sig.side)} {units:g} units order ke liye", ref)

            # Order Executor
            rr = self.reward_risk()
            if sig.entry_price is not None:
                return self._place_stop(inst, sig, units, rr, account)
            entry = price.ask if sig.side > 0 else price.bid
            stop = entry - sig.side * sig.stop_distance
            tp = entry + sig.side * rr * sig.stop_distance
            trade = self.broker.market_order(inst.name, sig.side * units, stop, tp)
            self.risk.remember(trade.id, trade.entry, stop, sig.atr, instrument=inst.name, units=trade.units,
                               opened=self.clock(), tp=tp)
            self.known_trades[str(trade.id)] = inst.name
            A.trade_refs[str(trade.id)] = ref
            if self.cfg["learn"]:
                self.learner.record_signal(sig, taken=True, trade_id=trade.id, entry=trade.entry)
            A.step(ref, "executor", "pass", f"Order laga: {side_word(sig.side)} {units:g} @ {pf(trade.entry)} · "
                   f"SL {pf(stop)} · TP {pf(tp)} ({rr}R)")
            A.mark(ref, taken=True, state="trade open", trade_id=str(trade.id))
            A.count("executor", "orders")
            A.did("executor", f"{name} {side_word(sig.side)} {units:g} @ {pf(trade.entry)} · SL {pf(stop)} · TP {pf(tp)}",
                  ref, "good")
            A.handoff("executor", "manager", f"{name} trade #{trade.id} sambhalne ko", ref)
            self.journal.write("open", inst.name, sig.side, units=units, entry=trade.entry,
                               stop=stop, tp=tp, note=sig.reason)
            log.info("OPEN %s %s units=%s entry=%s sl=%s tp=%s", inst.name,
                     side_word(sig.side), units, trade.entry, stop, tp)
            return trade
        except Exception as e:
            log.error("order %s failed: %s", inst.name, e)
            self.journal.write("error", inst.name, sig.side, reason=str(e))
            A.step(ref, "executor", "block", f"Order fail: {e}")
            A.did("executor", f"{name}: order fail ({e})", ref, "bad")
            return None

    # ---- breakout entries: stop order valid for the next candle only ---------------
    def _place_stop(self, inst, sig, units, rr, account):
        A, ref, name = self.agents, ref_for(inst.name, sig.time), pair(inst.name)
        tf_s = GRANULARITY_SECONDS[self.cfg["entry_timeframe"]]
        entry, stop = sig.entry_price, sig.stop_price
        tp = entry + sig.side * rr * abs(entry - stop)
        expire = sig.time + 2 * tf_s                     # end of the candle after the alert candle
        oid = self.broker.stop_order(inst.name, sig.side * units, entry, stop, tp, expire)
        self.risk.state.setdefault("pending", {})[oid] = {
            "instrument": inst.name, "side": sig.side, "units": sig.side * units, "entry": entry, "stop": stop,
            "tp": tp, "atr": sig.atr, "ref": ref, "expire": expire, "sig_time": sig.time,
            "stop_dist": abs(entry - stop), "features": sig.features, "day": ema_break.ny_day(self.clock())}
        self.risk.save()
        A.step(ref, "executor", "pass", f"Stop order laga: {side_word(sig.side)} {units:g} jab price {pf(entry)} tode · "
               f"SL {pf(stop)} · TP {pf(tp)} ({rr}R) · {ny_time(expire)} NY tak valid")
        A.mark(ref, state="order laga (intezaar)")
        A.count("executor", "orders")
        A.did("executor", f"{name} {side_word(sig.side)} stop order @ {pf(entry)} · SL {pf(stop)} · TP {pf(tp)}", ref, "good")
        self.journal.write("order", inst.name, sig.side, units=units, entry=entry, stop=stop, tp=tp, note=sig.reason)
        log.info("STOP ORDER %s %s units=%s at=%s sl=%s tp=%s", inst.name, side_word(sig.side), units, entry, stop, tp)
        return oid

    def check_pending(self):
        """Pending breakout orders: filled -> track the trade; not triggered in time -> cancelled."""
        pend = self.risk.state.get("pending") or {}
        A = self.agents
        for oid, o in list(pend.items()):
            try:
                st = self.broker.order_status(oid)
            except Exception as e:
                log.error("order status %s: %s", oid, e)
                continue
            ref, name = o["ref"], pair(o["instrument"])
            if st.get("state") == "FILLED" and st.get("trade_id"):
                tid = str(st["trade_id"])
                self.risk.remember(tid, o["entry"], o["stop"], o["atr"], instrument=o["instrument"], units=o["units"],
                                   opened=self.clock(), tp=o["tp"])
                self.known_trades[tid] = o["instrument"]
                A.trade_refs[tid] = ref
                from .models import Signal
                self.learner.record_signal(Signal(o["instrument"], o["side"], o["stop_dist"], o["atr"], "ema_break",
                                                  time=o["sig_time"], features=o.get("features") or {}),
                                           taken=True, trade_id=tid, entry=o["entry"])
                self.risk.state.setdefault("day_trades", {})
                self.risk.state["day_trades"][o["day"]] = self.risk.state["day_trades"].get(o["day"], 0) + 1
                A.step(ref, "executor", "pass", f"Price ne {pf(o['entry'])} toda: trade khula (#{tid})")
                A.mark(ref, taken=True, state="trade open", trade_id=tid)
                A.did("executor", f"{name} entry ho gayi @ {pf(o['entry'])}", ref, "good")
                A.handoff("executor", "manager", f"{name} trade #{tid} sambhalne ko", ref)
                del pend[oid]
            elif st.get("state") in ("CANCELLED", "TRIGGERED") or self.clock() > o["expire"] + 90:
                if st.get("state") == "PENDING":
                    try:
                        self.broker.cancel_order(oid)
                    except Exception as e:
                        log.error("cancel %s: %s", oid, e)
                        continue
                A.step(ref, "executor", "block", "Agli candle ne level nahi toda: setup cancel (koi trade nahi)")
                A.mark(ref, state="cancel (break nahi hua)")
                A.did("executor", f"{name} setup cancel: agli candle ne {pf(o['entry'])} nahi toda", ref, "info")
                del pend[oid]
        self.risk.save()

    def trades_today(self):
        day = ema_break.ny_day(self.clock())
        filled = (self.risk.state.get("day_trades") or {}).get(day, 0)
        waiting = sum(1 for o in (self.risk.state.get("pending") or {}).values() if o.get("day") == day)
        return filled + waiting

    def open_risk(self):
        """Money lost if every open trade and pending order hit its stop now (only the part still at risk)."""
        total = 0.0
        live = {str(t.id): t for t in self.broker.open_trades()}
        items = []
        for tid, info in self.risk.state["trades"].items():
            t = live.get(tid)
            items.append({**info, "stop_now": t.stop} if t and t.stop is not None else info)
        items += list((self.risk.state.get("pending") or {}).values())
        for info in items:
            inst, units = info.get("instrument"), info.get("units")
            if not inst or not units:
                continue
            stop = info.get("stop_now", info.get("stop"))
            loss = (info["entry"] - stop) * units
            if loss <= 0:
                continue                                   # stop already at/above entry: nothing at risk
            try:
                total += loss * self.broker.quote_to_home(inst)
            except Exception:
                pass
        return total

    def _skip(self, inst, sig, agent, reason):
        A, ref = self.agents, ref_for(inst.name, sig.time)
        nice = hinglish_reason(reason)
        A.step(ref, agent, "block", nice)
        A.count(agent, "blocked")
        A.did(agent, f"{pair(inst.name)} {side_word(sig.side)} roka: {nice}", ref, "warn")
        A.mark(ref, state="roka gaya")
        self.journal.write("skip", inst.name, sig.side, reason=reason, note=sig.reason)
        if self.cfg["learn"]:
            self.learner.record_signal(sig, taken=False, skip_reason=reason)
            A.handoff(agent, "learner", f"{pair(inst.name)} ko shadow mein follow karne ko (result se seekhega)", ref)
            A.step(ref, "learner", "info", "Time Machine is setup ko chart pe follow karega: SL lagta ya TP?")
        return None

    # ---- News Monitor ------------------------------------------------------
    def report_news(self, now):
        A, N = self.agents, self.news
        if not N.p["enabled"]:
            A.status("news", "Band hai (config mein news.enabled = false)", "idle")
            return
        if N.refresh():
            curs = self._currencies()
            wk = [e for e in N.upcoming(now, 24 * 7, curs) if e["impact"] == "High"]
            A.did("news", f"Calendar update: is hafte {len(wk)} bade (High) news aapke pairs ke liye")
        if N.error and not N.events:
            A.status("news", f"Calendar nahi mil raha ({N.error}). Trades chalte rahenge, news block band hai.", "warn")
            return
        curs = self._currencies()
        nxt = [e for e in N.upcoming(now, 24 * 7, curs) if e["impact"] == "High" and e["time"] >= now]
        active = [e for e in N.active(now) if e["currency"] in curs]
        keys = {f"{e['currency']}|{e['title']}|{e['time']}" for e in active}
        for e in active:
            k = f"{e['currency']}|{e['title']}|{e['time']}"
            if k not in self._news_active:
                pairs = [pair(i.name) for i in self.universe() if e["currency"] in i.name.split("_")]
                A.did("news", f"{e['currency']} {e['title']} {ny_time(e['time'])} NY: {', '.join(pairs)} ke naye trades band", tone="bad")
                A.handoff("news", "timer", f"{e['currency']} ke trades rokne ko ({e['title']})")
        for k in self._news_active - keys:
            cur, title, _ = k.split("|", 2)
            A.did("news", f"{cur} {title} ka time nikal gaya: {cur} pairs pe trades phir allowed", tone="good")
        self._news_active = keys
        if active:
            e = active[0]
            A.status("news", f"Abhi BLOCK: {e['currency']} {e['title']} ({ny_time(e['time'])} NY)", "bad")
        elif nxt:
            e = nxt[0]
            mins = int((e["time"] - now) // 60)
            A.status("news", f"Agla bada news: {e['currency']} {e['title']} {ny_time(e['time'])} NY "
                     f"({mins // 60}h {mins % 60}m mein)", "warn" if mins < 60 else "ok")
        else:
            A.status("news", "Is hafte aapke pairs ke liye koi bada news nahi bacha", "ok")
        A.plan("news", f"High news pe us currency ke naye trades {N.p['before_min']} min pehle se "
               f"{N.p['after_min']} min baad tak band. Calendar har {N.p['refresh_minutes']} min update. "
               "Open trades ka SL/TP broker pe laga rehta hai.")

    def _currencies(self):
        return {c for i in self.universe() for c in i.name.split("_")}

    def news_list(self, now):
        curs = self._currencies()
        out = []
        for e in self.news.upcoming(now, 24 * 7, curs):
            a, b = self.news.window(e)
            out.append({**e, "block": e["impact"] in self.news.p["block_impacts"], "from": a, "to": b,
                        "active": a <= now <= b and e["impact"] in self.news.p["block_impacts"],
                        "pairs": [i.name for i in self.universe() if e["currency"] in i.name.split("_")]})
        return out

    # ---- Exit Planner ------------------------------------------------------
    def trading_day_start(self):
        """Unix time when the current trading day began (17:00 New York)."""
        ny = datetime.fromtimestamp(self.clock(), timezone.utc).astimezone(NY)
        t = ny.replace(hour=17, minute=0, second=0, microsecond=0)
        if t > ny:
            t -= timedelta(days=1)
        return t.timestamp()

    def recover_untracked(self, open_trades):
        """Record the result of bot trades that closed without being recorded. Checks every 10 minutes."""
        now = self.clock()
        if now - getattr(self, "_last_recover", 0) < 600:
            return 0
        self._last_recover = now
        open_ids = {str(t.id) for t in open_trades} | set(self.risk.state["trades"])
        done = 0
        for row in self.learner.untracked_taken(open_ids)[:20]:
            tid = str(row["trade_id"])
            try:
                c = self.broker.closed_trade(tid)
            except Exception as e:
                log.error("recover %s: %s", tid, e)
                continue
            if not c or not row["stop_dist"]:
                continue
            side, entry, dist = row["side"], row["entry"], row["stop_dist"]
            r = (c["price"] - entry) * side / dist
            how = "SL 🛑" if r < -0.05 else ("Breakeven" if abs(r) <= 0.05 else
                                             ("TP 🎯" if r > 1.5 * self.reward_risk() / 2 else "Trailing SL (profit)"))
            ref = ref_for(row["instrument"], row["time"])
            self.learner.set_real_result(tid, r)
            self.learner.record_close(trade_id=tid, instrument=row["instrument"], side=side, units=c.get("units"),
                                      entry=entry, exit=c["price"], stop=entry - side * dist, tp=None,
                                      r=round(r, 3), pl=c.get("pl"), opened=None,
                                      closed=c.get("time") or now, how=how, ref=ref)
            self.agents.did("manager", f"{pair(row['instrument'])} ka chhoota hua result wapas laaya: {r:+.2f}R · {how}",
                            ref, "good" if r > 0.05 else ("bad" if r < -0.05 else "info"))
            self.agents.mark(ref, state="khatam", result=f"{r:+.2f}R", r=round(r, 2))
            done += 1
        return done

    def today_tally(self, open_trades):
        start = self.trading_day_start()
        closed = self.learner.closed_summary(start)
        opened = self.agents.agents["executor"]["counts"].get("orders", 0)
        missing = max(0, opened - len(open_trades) - closed["n"])
        return {"since": start, "opened": opened, "open_now": len(open_trades), "closed": closed["n"],
                "wins": closed["wins"], "losses": closed["losses"], "be": closed["be"],
                "r": closed["total_r"], "pl": closed["pl"], "missing": missing}

    def _spot_closed(self, open_trades):
        """A trade the bot opened is no longer open: record how it ended. Works across restarts, because the
        list of bot trades lives in the saved risk state, not only in memory."""
        A = self.agents
        open_ids = {str(t.id) for t in open_trades}
        for tid in [t for t in list(self.risk.state["trades"]) if t not in open_ids]:
            info = self.risk.state["trades"].get(tid) or {}
            ref = A.trade_refs.get(tid)
            try:
                c = self.broker.closed_trade(tid)
            except Exception as e:
                log.error("closed trade %s: %s", tid, e)
                c = None
            if not c:                         # not readable yet: try again next tick, give up after ~10 minutes
                info["tries"] = info.get("tries", 0) + 1
                if info["tries"] > 30:
                    log.warning("trade %s closed but its result could not be read; dropping it", tid)
                    self.risk.state["trades"].pop(tid, None)
                self.risk.save()
                continue
            inst = info.get("instrument") or c.get("instrument") or self.known_trades.get(tid) or "?"
            px, entry, stop = c["price"], info.get("entry"), info.get("stop")
            if entry is None or stop is None:
                continue
            risk = abs(entry - stop)
            side = 1 if stop < entry else -1
            r = (px - entry) * side / risk if risk else 0.0
            tp = info.get("tp")
            if tp is not None and risk and abs(px - tp) <= 0.15 * risk:
                how = "TP 🎯"
            elif abs(r) <= 0.05:
                how = "Breakeven"
            elif r < 0:
                how = "SL 🛑"
            else:
                how = "Trailing SL (profit)"
            units = info.get("units") or c.get("units")
            pl = c.get("pl")
            if pl is None and units:
                try:
                    pl = (px - entry) * units * self.broker.quote_to_home(inst)
                except Exception:
                    pl = None
            self.learner.set_real_result(tid, r)
            self.learner.record_close(trade_id=tid, instrument=inst, side=side, units=units, entry=entry, exit=px,
                                      stop=stop, tp=tp, r=round(r, 3), pl=None if pl is None else round(pl, 2),
                                      opened=info.get("opened"), closed=c.get("time") or self.clock(), how=how, ref=ref)
            money = f" ({pl:+,.0f} {self.status.get('currency', '')})" if pl is not None else ""
            A.did("manager", f"{pair(inst)} close @ {pf(px)}: {r:+.2f}R{money} · {how}", ref,
                  "good" if r > 0.05 else ("bad" if r < -0.05 else "info"))
            A.count("manager", "closed")
            A.count("manager", "r_x100", int(round(r * 100)))
            A.step(ref, "manager", "pass", f"Trade close @ {pf(px)}: {r:+.2f}R{money} · {how}")
            A.mark(ref, state="khatam", result=f"{r:+.2f}R", r=round(r, 2))
            A.handoff("manager", "learner", f"{pair(inst)} ka result {r:+.2f}R seekhne ko", ref)
            self.journal.write("close", inst, side, entry=entry, note=f"{r:+.2f}R exit {px} {how}")
            log.info("CLOSED %s %s %+.2fR %s", inst, tid, r, how)
            self.known_trades.pop(tid, None)
            self.risk.state["trades"].pop(tid, None)
            self.risk.save()

    def manage(self, trades):
        A = self.agents
        plans = []
        for t in trades:
            info = self.risk.state["trades"].get(str(t.id))
            if not info:
                continue
            ref = A.trade_refs.get(str(t.id))
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
            nxt = ("trailing chal raha" if progress >= self.cfg["trail_start_r"] else
                   f"+{self.cfg['trail_start_r']}R pe trailing" if progress >= self.cfg["breakeven_at_r"] else
                   f"+{self.cfg['breakeven_at_r']}R pe SL breakeven")
            plans.append(f"{pair(t.instrument)} {side_word(t.side)} abhi {progress:+.2f}R → {nxt}")
            new_stop = None
            if self.ema:
                continue                      # breakout mode: fixed SL and 3R target, no breakeven/trailing
            if progress >= self.cfg["trail_start_r"]:
                new_stop = now_px - t.side * self.cfg["trail_atr_mult"] * info["atr"]
            if progress >= self.cfg["breakeven_at_r"]:
                be = info["entry"]
                new_stop = be if new_stop is None else (max(new_stop, be) if t.side > 0 else min(new_stop, be))
            current = t.stop if t.stop is not None else info["stop"]
            if new_stop is not None and (new_stop - current) * t.side > 1e-12:
                try:
                    self.broker.modify_stop(t.id, new_stop, instrument=t.instrument)
                    what = "breakeven pe" if abs(new_stop - info["entry"]) < 1e-12 else "trail kiya"
                    A.did("manager", f"{pair(t.instrument)} SL {what}: {pf(new_stop)} (+{progress:.2f}R)", ref, "good")
                    A.step(ref, "manager", "info", f"SL {what} → {pf(new_stop)} jab trade +{progress:.2f}R tha")
                    A.count("manager", "sl_moves")
                    self.journal.write("move_sl", t.instrument, t.side, stop=new_stop, note=f"+{progress:.2f}R")
                    log.info("SL %s %s -> %s (+%.2fR)", t.instrument, t.id, new_stop, progress)
                except Exception as e:
                    log.error("move SL %s failed: %s", t.id, e)
        mine = [t for t in trades if str(t.id) in self.risk.state["trades"]]
        A.status("manager", f"{len(mine)} open trade" + ("s" if len(mine) != 1 else ""), "ok" if mine else "idle")
        if self.ema:
            A.plan("manager", (" · ".join(plans) + " · " if plans else "") +
                   "Is strategy mein SL aur TP (3R) fixed hain: na breakeven, na trailing.")
            return
        A.plan("manager", " · ".join(plans) if plans else
               f"Koi open trade nahi. Naya trade aaya to +{self.cfg['breakeven_at_r']}R pe breakeven, "
               f"+{self.cfg['trail_start_r']}R se trailing.")

    # ---- Time Machine ------------------------------------------------------
    def report_resolved(self):
        A = self.agents
        for row in self.learner.last_resolved:
            ref = ref_for(row["instrument"], row["time"])
            r = row["r"]
            mist = ", ".join(MISTAKE_WORDS.get(m, m) for m in row["mistakes"][:2])
            who = "bot ka trade" if row["taken"] else ("session ke bahar, setup ki jaanch mein gina"
                                                   if row.get("skip_reason") == "outside US session" else "chhoda hua setup")
            A.did("learner", f"{pair(row['instrument'])} ({who}) chart pe {r:+.2f}R hota"
                  + (f" · galti: {mist}" if mist else ""), ref, "good" if r > 0 else ("bad" if r < 0 else "info"))
            A.count("learner", "followed")
            j = A.journeys.get(ref)
            if j is not None:
                A.step(ref, "learner", "info", f"Chart pe result: {r:+.2f}R" + (f" · galti: {mist}" if mist else ""))
                if not j["taken"]:
                    A.mark(ref, state="khatam (shadow)", result=f"{r:+.2f}R agar liya hota", r=round(r, 2))
        snap = self.learner.snapshot()
        A.status("learner", f"30 din: {snap['stats_30d']['setups_followed']} setups follow · "
                 f"{len(snap['filters'])} seekhe rules", "ok")
        A.plan("learner", "Agla daily review 17:00 New York (galtiyan → naye rules, ek setting ka walk-forward test)")

    def ema_backtest(self, day):
        """EMA 9/15 breakout on ~2 years of real M5 candles, spread included, split 70% tuning / 30% unseen.
        The bot trades on demo only if the unseen part has enough trades and a good profit factor."""
        from .learner import _card_r
        A, ep = self.agents, self.ema_params()
        tf = self.cfg["entry_timeframe"]
        names = [self.cfg["base_instrument"]]
        self.learner.put("gate_progress", {"running": True, "started": self.clock()})
        A.did("learner", f"Backtest shuru: {', '.join(map(pair, names))} ke ~{self.cfg['backtest_days']} din ke asli "
                         f"{tf} candles download ho rahe hain (spread ke saath)…")
        start = self.clock() - self.cfg["backtest_days"] * 86400
        try:
            spreads = {k: p.spread for k, p in self.broker.prices(names).items()}
        except Exception as e:
            log.error("spreads for backtest: %s", e)
            spreads = {}
        trades, span = [], [None, None]
        for n in names:
            candles = self.broker.candles_range(n, tf, start)
            if len(candles) < 500:
                continue
            for t in ema_break.backtest(candles, ep, spreads.get(n, 0.0)):
                t["pair"] = n
                trades.append(t)
            span[0] = min(span[0] or candles[0].time, candles[0].time)
            span[1] = max(span[1] or candles[-1].time, candles[-1].time)
        if not span[0]:
            self.learner.put("gate", {"passed": False, "made": self.clock(), "reason": "data nahi mila"})
            A.did("learner", "Backtest: purana data nahi mila", tone="bad")
            return None
        split = span[0] + 0.7 * (span[1] - span[0])
        old = [t["r"] for t in trades if t["time"] < split]
        new = [t["r"] for t in trades if t["time"] >= split]
        res = {"made": self.clock(), "day": day, "from": span[0], "to": span[1], "split": split,
               "pairs": names, "timeframe": tf, "spread": spreads, "rules": {k: ep[k] for k in ep},
               "all": _card_r([t["r"] for t in trades]), "tuning": _card_r(old), "unseen": _card_r(new),
               "need_trades": self.cfg["gate_min_unseen_trades"], "need_pf": self.cfg["gate_min_pf"]}
        u = res["unseen"]
        res["passed"] = u["n"] >= self.cfg["gate_min_unseen_trades"] and pf_of(u) >= self.cfg["gate_min_pf"]
        res["reason"] = ("pass" if res["passed"] else
                         f"unseen mein sirf {u['n']} trades (chahiye {self.cfg['gate_min_unseen_trades']}+)"
                         if u["n"] < self.cfg["gate_min_unseen_trades"] else
                         f"unseen PF {u['pf']} (chahiye {self.cfg['gate_min_pf']}+)")
        self.learner.put("ema_backtest", res)
        self.learner.put("gate_progress", {"running": False, "finished": self.clock()})
        self.learner.put("gate", {"passed": res["passed"], "made": res["made"], "reason": res["reason"]})
        self.learner.lesson(day, "validate", f"EMA 9/15 backtest: tuning {res['tuning']['n']} trades PF {res['tuning']['pf']} "
                            f"({res['tuning']['total_r']:+.1f}R) · unseen {u['n']} trades PF {u['pf']} ({u['total_r']:+.1f}R) · "
                            + ("✅ PASS: demo pe trading chalu" if res["passed"] else f"❌ gate band: {res['reason']}"))
        A.did("learner", f"Backtest: unseen {u['n']} trades, win {u['win_pct']}%, PF {u['pf']}, {u['total_r']:+.1f}R → "
              + ("PASS, demo trading chalu" if res["passed"] else "gate band, sirf dekhega"),
              tone="good" if res["passed"] else "bad")
        return res

    # ---- forward tests: live shadow of a backtest winner -------------------------
    def forward_tick(self, now):
        state = self.learner.get("forward", {})
        changed = False
        for ft in self.cfg["forward_tests"]:
            key = f"{ft['instrument']}|{ft['timeframe']}|{ft['reward_risk']}"
            tf_s = GRANULARITY_SECONDS[ft["timeframe"]]
            bucket = int((now - self.cfg["scan_delay_seconds"]) // tf_s)
            st = state.setdefault(key, {**ft, "started": now, "setups": [], "last_bucket": None})
            if st["last_bucket"] == bucket:
                continue
            st["last_bucket"] = bucket
            changed = True
            candles = self.broker.candles(ft["instrument"], ft["timeframe"], 300)
            closed = [c for c in candles if c.complete]
            p = {**self.ema_params(), "reward_risk": ft["reward_risk"], "max_trades_per_day": 0}
            sig = ema_break.evaluate(ft["instrument"], candles, p)
            if sig and not any(x["time"] == sig.time for x in st["setups"]):
                st["setups"].append({"time": sig.time, "side": sig.side, "trig": sig.entry_price,
                                     "stop": sig.stop_price, "state": "open"})
                self.agents.did("learner", f"Forward test {pair(ft['instrument'])} {ft['timeframe']} 1:{ft['reward_risk']}: "
                                           f"naya {side_word(sig.side)} setup @ {pf(sig.entry_price)} (sirf follow, trade nahi)")
            for x in st["setups"]:
                if x["state"] != "open":
                    continue
                after = [c for c in closed if c.time >= x["time"] + tf_s]
                res = ema_break.follow(x["side"], x["trig"], x["stop"], ft["reward_risk"], after)
                if res is None:
                    continue
                r, _ = res
                if r == "cancel":
                    x["state"] = "cancel"
                else:
                    x.update(state="done", r=round(r, 3), closed=after[min(len(after) - 1, _ - 1)].time)
                    self.agents.did("learner", f"Forward test {pair(ft['instrument'])} {ft['timeframe']}: setup "
                                               f"{r:+.2f}R pe band", tone="good" if r > 0 else "bad")
            st["setups"] = st["setups"][-500:]
        if changed:
            self.learner.put("forward", state)

    def forward_view(self):
        from .learner import _card_r
        out = []
        for key, st in (self.learner.get("forward", {}) or {}).items():
            done = [x for x in st["setups"] if x["state"] == "done"]
            out.append({"key": key, "instrument": st["instrument"], "timeframe": st["timeframe"],
                        "reward_risk": st["reward_risk"], "started": st["started"], "card": _card_r([x["r"] for x in done]),
                        "open": sum(1 for x in st["setups"] if x["state"] == "open"),
                        "cancelled": sum(1 for x in st["setups"] if x["state"] == "cancel"),
                        "recent": sorted(st["setups"], key=lambda x: -x["time"])[:12]})
        return out

    VARIATION_TFS = ["M5", "M15", "H1", "H4"]
    VARIATION_RRS = [1.5, 2.0, 3.0, 4.0, 5.0]

    def ema_variations(self, day):
        """Same EMA 9/15 rules on the base instrument with different targets and timeframes, every hour
        separately. ~2 years, spread charged, 70/30 split. Only results good on BOTH halves count."""
        from .learner import _card_r
        A, n = self.agents, self.cfg["base_instrument"]
        start = self.clock() - self.cfg["backtest_days"] * 86400
        try:
            spread = self.broker.prices([n])[n].spread
        except Exception:
            spread = 0.0
        A.did("learner", f"Variations test shuru: {pair(n)} · targets {self.VARIATION_RRS} × timeframes "
                         f"{self.VARIATION_TFS} × har ghanta…")
        rows, hours_ok = [], []
        for tf in self.VARIATION_TFS:
            candles = self.broker.candles_range(n, tf, start)
            if len(candles) < 500:
                continue
            split = candles[0].time + 0.7 * (candles[-1].time - candles[0].time)
            for rr in self.VARIATION_RRS:
                p = {**self.ema_params(), "reward_risk": rr, "max_trades_per_day": 0}
                ts = ema_break.backtest(candles, p, spread, windows=ema_break.ALL_DAY)
                old = [t for t in ts if t["time"] < split]
                new = [t for t in ts if t["time"] >= split]
                row = {"tf": tf, "rr": rr, "all": _card_r([t["r"] for t in ts]),
                       "tuning": _card_r([t["r"] for t in old]), "unseen": _card_r([t["r"] for t in new]),
                       "from": candles[0].time, "to": candles[-1].time}
                row["passed"] = (row["unseen"]["n"] >= self.cfg["cell_min_unseen_trades"]
                                 and pf_of(row["unseen"]) >= self.cfg["cell_min_unseen_pf"]
                                 and pf_of(row["tuning"]) >= self.cfg["cell_min_tuning_pf"])
                for h in range(24):
                    ho = [t["r"] for t in old if t["hour"] == h]
                    hn = [t["r"] for t in new if t["hour"] == h]
                    cell = {"tf": tf, "rr": rr, "hour": h, "tuning": _card_r(ho), "unseen": _card_r(hn)}
                    if (len(hn) >= self.cfg["cell_min_unseen_trades"] and pf_of(cell["unseen"]) >= self.cfg["cell_min_unseen_pf"]
                            and pf_of(cell["tuning"]) >= self.cfg["cell_min_tuning_pf"]):
                        hours_ok.append(cell)
                rows.append(row)
            del candles
        res = {"made": self.clock(), "instrument": n, "rows": rows, "hours_ok": hours_ok,
               "tested": len(rows) * 25, "spread": spread}
        self.learner.put("variations", res)
        best = max(rows, key=lambda r: r["unseen"]["total_r"]) if rows else None
        self.learner.lesson(day, "variations", f"Variations ({pair(n)}): {len(rows)} combination + har ghanta test. "
                            + (f"{sum(r['passed'] for r in rows)} combination aur {len(hours_ok)} ghante pass. " if rows else "")
                            + (f"Sabse achha unseen: {best['tf']} 1:{best['rr']} → PF {best['unseen']['pf']}, "
                               f"{best['unseen']['total_r']:+.0f}R." if best else ""))
        A.did("learner", f"Variations poore: {sum(r['passed'] for r in rows)} combination pass, {len(hours_ok)} ghante pass",
              tone="good" if hours_ok or any(r["passed"] for r in rows) else "info")
        return res

    def ema_research(self, day):
        """Backtest the breakout rules on every instrument, all hours, spread included, split 70/30 per
        instrument. Instrument+hour cells good on BOTH halves join the trading list."""
        from .learner import _card_r
        A, ep = self.agents, {**self.ema_params(), "max_trades_per_day": 99}
        tf = self.cfg["entry_timeframe"]
        names = [i.name for i in self.universe()]
        A.did("learner", f"Research shuru: {len(names)} instruments, har ghanta, ~{self.cfg['research_days']} din ka "
                         f"{tf} data (spread ke saath). Ismein 10-30 minute lagte hain…")
        try:
            spreads = {k: p.spread for k, p in self.broker.prices(names).items()}
        except Exception as e:
            log.error("spreads for research: %s", e)
            spreads = {}
        start = self.clock() - self.cfg["research_days"] * 86400
        rows, cells = [], []
        t0 = self.clock()
        for k, n in enumerate(names):
            self.learner.put("research_progress", {"done": k, "total": len(names), "current": n, "started": t0})
            try:
                candles = self.broker.candles_range(n, tf, start)
            except Exception as e:
                log.error("research %s: %s", n, e)
                continue
            if len(candles) < 500:
                continue
            ts = ema_break.backtest(candles, ep, spreads.get(n, 0.0), windows=ema_break.ALL_DAY)
            split = candles[0].time + 0.7 * (candles[-1].time - candles[0].time)
            del candles
            old = [t for t in ts if t["time"] < split]
            new = [t for t in ts if t["time"] >= split]
            row = {"pair": n, "spread": spreads.get(n), "all": _card_r([t["r"] for t in ts]),
                   "tuning": _card_r([t["r"] for t in old]), "unseen": _card_r([t["r"] for t in new]), "hours": []}
            for h in range(24):
                ho = [t["r"] for t in old if t["hour"] == h]
                hn = [t["r"] for t in new if t["hour"] == h]
                if len(hn) < 5:
                    continue
                cell = {"instrument": n, "hour": h, "tuning": _card_r(ho), "unseen": _card_r(hn)}
                row["hours"].append(cell)
                if (len(hn) >= self.cfg["cell_min_unseen_trades"]
                        and pf_of(cell["unseen"]) >= self.cfg["cell_min_unseen_pf"]
                        and pf_of(cell["tuning"]) >= self.cfg["cell_min_tuning_pf"]):
                    cells.append(cell)
            rows.append(row)
        rows.sort(key=lambda r: -r["unseen"]["total_r"])
        tested = sum(len(r["hours"]) for r in rows)
        res = {"made": self.clock(), "day": day, "days": self.cfg["research_days"], "timeframe": tf,
               "instruments": rows, "cells_tested": tested, "passed": cells,
               "rules": {"min_unseen_trades": self.cfg["cell_min_unseen_trades"],
                         "min_unseen_pf": self.cfg["cell_min_unseen_pf"], "min_tuning_pf": self.cfg["cell_min_tuning_pf"]}}
        self.learner.put("research", res)
        self.learner.put("research_progress", {"done": len(names), "total": len(names), "current": None,
                                               "finished": self.clock()})
        old_list = {(c["instrument"], c["hour"]) for c in self.learner.get("trade_list", [])}
        new_list = [{"instrument": c["instrument"], "hour": c["hour"], "unseen_pf": c["unseen"]["pf"],
                     "unseen_n": c["unseen"]["n"]} for c in cells]
        self.learner.put("trade_list", new_list)
        added = [c for c in new_list if (c["instrument"], c["hour"]) not in old_list]
        removed = old_list - {(c["instrument"], c["hour"]) for c in new_list}
        if added or removed:
            self.learner.bump_rules(f"trading list: +{len(added)} / -{len(removed)}")
        self.learner.lesson(day, "research", f"Research: {len(rows)} instruments, {tested} pair+ghanta test kiye. "
                            f"{len(cells)} pass hue (unseen PF {self.cfg['cell_min_unseen_pf']}+, "
                            f"{self.cfg['cell_min_unseen_trades']}+ trades, purane data pe bhi PF "
                            f"{self.cfg['cell_min_tuning_pf']}+)."
                            + (" Naye: " + ", ".join(f"{pair(c['instrument'])} {c['hour']}:00" for c in added[:8]) if added else ""))
        A.did("learner", f"Research poori: {len(cells)} pair+ghanta trading list mein"
              + (f" (naye {len(added)})" if added else ""), tone="good" if cells else "info")
        return res

    def validate_setup(self, day):
        """Report card + experiments: today's rules and 5 alternatives on real broker history, spread included."""
        A = self.agents
        n = self.learner.p["validate_bars"]
        if self.ema:
            out = None
            try:
                out = self.ema_backtest(day)
            except Exception as e:
                log.exception("ema backtest failed: %s", e)
                A.did("learner", f"Backtest fail: {e}", tone="bad")
            try:
                self.ema_variations(day)
            except Exception as e:
                log.exception("variations failed: %s", e)
                A.did("learner", f"Variations fail: {e}", tone="bad")
            try:
                self.ema_research(day)
            except Exception as e:
                log.exception("research failed: %s", e)
                A.did("learner", f"Research fail: {e}", tone="bad")
            return out

        def history(name):
            return (self.broker.candles(name, self.cfg["trend_timeframe"], n),
                    self.broker.candles(name, self.cfg["entry_timeframe"], n))
        try:
            names = [i.name for i in self.universe()]
            A.did("learner", f"Experiment shuru: {len(names)} charts ke ~7 mahine ke asli data pe 6 versions test "
                             "kar raha hoon (spread ke kharche ke saath)…")
            try:
                spreads = {k: p.spread for k, p in self.broker.prices(names).items()}
            except Exception as e:
                log.error("spreads for experiment: %s", e)
                spreads = {}
            out = self.learner.experiment(day, history, names, LIQUID, self.params(), self.reward_risk(),
                                          self.cfg["breakeven_at_r"], spreads, self.in_session)
            if out:
                card = self.learner.get("report_card")
                a = card["all"]
                A.did("learner", f"Report card (spread ke saath): {a['n']} trades, win {a['win_pct']}%, "
                      f"{a['total_r']:+.1f}R, PF {a['pf']}", tone="good" if card["verdict"] == "pass" else "bad")
                if out["adopted"]:
                    v = next(x for x in out["table"] if x["id"] == out["adopted"])
                    A.did("learner", f"Naya version apnaya: {v['name']}", tone="good")
                    A.handoff("learner", "rules", f"Naye rules laagu: {v['name']}")
                else:
                    A.did("learner", "Experiment: koi version pakka behtar nahi nikla, rules wahi rahe")
        except Exception as e:
            log.exception("experiment failed: %s", e)
            A.did("learner", f"Experiment fail: {e}", tone="bad")

    def review(self, day):
        log.info("daily review for %s", day)
        if self.ema:                     # simple mode: no auto rules; just re-test on the newest data
            self.learner.put("last_review_day", day)
            self.validate_setup(day)
            return
        A = self.agents
        n = self.learner.p["tune_bars"]

        def history(name):
            return (self.broker.candles(name, self.cfg["trend_timeframe"], n),
                    self.broker.candles(name, self.cfg["entry_timeframe"], n))
        try:
            before = len(self.learner.lessons(500))
            names = [i.name for i in self.universe()]
            liquid = ["EUR_USD", "GBP_USD", "USD_JPY", "XAU_USD", "AUD_USD", "USD_CAD", "NAS100_USD", "EUR_JPY",
                      "GBP_JPY", "USD_CHF", "SPX500_USD", "XAG_USD"]
            tune_on = [n for n in liquid if n in names] + [n for n in names if n not in liquid]
            out = self.learner.daily_review(day, history, self.params(), self.reward_risk(),
                                            tune_on, self.cfg["breakeven_at_r"])
            mist = sorted(out["mistakes"].items(), key=lambda x: -x[1])
            A.did("learner", f"Daily review {day}: " + (", ".join(f"{n}× {MISTAKE_WORDS.get(k, k)}"
                                                                    for k, n in mist[:3]) or "koi galti nahi mili"))
            for l in reversed(self.learner.lessons(500)[: len(self.learner.lessons(500)) - before]):
                A.did("learner", l["text"], tone="good")
                if l["kind"] in ("filter_on", "filter_off"):
                    A.handoff("learner", "timer", f"Naya rule: {l['text']}")
                elif l["kind"] == "tune" and "->" in l["text"]:
                    A.handoff("learner", "rules", f"Setting badli: {l['text']}")
            log.info("review done: %s", out)
            self.validate_setup(day)
        except Exception as e:
            log.exception("review failed: %s", e)
            A.did("learner", f"Review fail: {e}", tone="bad")

    # ---- Manager robot: brain + memory of what was already shown -------------
    def _brief_done(self, b):
        self.agents.did("news", "World-market brief taiyaar (Manager robot ke paas)", tone="good")

    def brain_context(self):
        snap = self.snapshot(light=True)
        st = snap["status"]
        return {
            "account": {k: st.get(k) for k in ("nav", "balance", "currency", "day_start_nav", "no_new_trades", "session_text")},
            "open_trades": st.get("open_trades"),
            "agents": [{"name": a["name"], "status": a["status"], "plan": a["plan"], "today": a["counts"],
                        "last": [e["text"] for e in a["events"][:4]]} for a in snap["agents"]],
            "signals": [{"pair": j["instrument"], "side": "BUY" if j["side"] > 0 else "SELL", "state": j["state"],
                         "result": j["result"], "steps": [f"{s['agent']}:{s['verdict']}:{s['text']}" for s in j["steps"]]}
                        for j in snap["journeys"][:12]],
            "charts": [{"pair": c["instrument"], "state": c["state"], "note": c["note"]} for c in snap["charts"]],
            "news": [{"cur": e["currency"], "title": e["title"], "impact": e["impact"], "time_ny": ny_time(e["time"]),
                      "forecast": e["forecast"], "previous": e["previous"], "actual": e["actual"]} for e in snap["news"][:15]],
            "learning": {k: snap["learning"][k] for k in ("filters", "lessons", "mistakes_30d", "stats_30d", "params")},
            "closed_trades": [{k: c[k] for k in ("instrument", "side", "entry", "exit", "r", "pl", "how")}
                              for c in self.learner.closed_trades(20)],
            "settings": {"risk": st.get("risk"), "strategy": st.get("params"), "reward_risk": st.get("reward_risk")},
        }

    def open_trades_view(self):
        """Open trades with what hitting SL / TP would mean in account currency."""
        out, conv = [], {}
        for t in self.broker.open_trades():
            d = {**t.__dict__, "init_stop": (self.risk.state["trades"].get(str(t.id)) or {}).get("stop"),
                 "ref": self.agents.trade_refs.get(str(t.id)), "sl_amt": None, "tp_amt": None}
            try:
                if t.instrument not in conv:
                    conv[t.instrument] = self.broker.quote_to_home(t.instrument)
                k = conv[t.instrument]
                if k:
                    if t.stop is not None:
                        d["sl_amt"] = round((t.stop - t.entry) * t.units * k, 2)
                    if t.take_profit is not None:
                        d["tp_amt"] = round((t.take_profit - t.entry) * t.units * k, 2)
            except Exception as e:
                log.error("sl/tp amount %s: %s", t.instrument, e)
            out.append(d)
        return out

    def next_review_time(self):
        """Unix time of the next 17:00 New York (trading-day roll = daily review)."""
        ny = datetime.fromtimestamp(self.clock(), timezone.utc).astimezone(NY)
        t = ny.replace(hour=17, minute=0, second=0, microsecond=0)
        if t <= ny:
            t = t + timedelta(days=1)
        return t.timestamp()

    def live_prices(self, max_age=2.0):
        """Fresh bid/ask/mid for every watched chart, cached for `max_age` seconds (one broker call)."""
        now = time.time()
        cache = getattr(self, "_live", None)
        if cache and now - cache["t"] < max_age:
            return cache
        try:
            got = self.broker.prices([i.name for i in self.universe()])
            data = {n: {"bid": p.bid, "ask": p.ask, "mid": p.mid, "open": p.tradeable} for n, p in got.items()}
            self._live = {"t": now, "prices": data, "error": None}
        except Exception as e:
            log.error("live prices failed: %s", e)
            self._live = {"t": now, "prices": (cache or {}).get("prices", {}), "error": str(e)}
        return self._live

    def correlation(self, a, b, n=200):
        """Correlation of hourly % moves over the last n candles, or None without enough data."""
        if a == b:
            return 1.0
        ca, cb = self._closes.get(a), self._closes.get(b)
        if not ca or not cb:
            return None
        m = min(len(ca), len(cb), n + 1)
        if m < 50:
            return None
        ra = [ca[-m + i + 1] / ca[-m + i] - 1 for i in range(m - 1)]
        rb = [cb[-m + i + 1] / cb[-m + i] - 1 for i in range(m - 1)]
        ma, mb = sum(ra) / len(ra), sum(rb) / len(rb)
        cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
        va = sum((x - ma) ** 2 for x in ra) ** 0.5
        vb = sum((y - mb) ** 2 for y in rb) ** 0.5
        return cov / (va * vb) if va and vb else None

    def mark_seen(self, keys):
        keys = [str(k)[:200] for k in keys or [] if k][:100]
        with self.lock:
            for k in keys:
                if k not in self.seen:
                    self.seen.append(k)
            self.seen = self.seen[-500:]
            if self.seen_path:
                tmp = self.seen_path + ".tmp"
                with open(tmp, "w") as f:
                    json.dump(self.seen, f)
                os.replace(tmp, self.seen_path)
        return len(self.seen)

    # ---- dashboard -----------------------------------------------------
    def snapshot(self, light=False):
        with self.lock:
            charts = sorted(self.board.values(), key=lambda r: -r.get("score", 0))
            status = dict(self.status)
        return {"status": status, "charts": charts, "learning": self.learner.snapshot(),
                "news": self.news_list(self.clock()), "news_error": self.news.error,
                "journal": self.journal.rows[-30:][::-1], **self.agents.snapshot(),
                "scan": getattr(self, "scan_progress", None),
                "mode": {"strategy": self.cfg["strategy"], "timeframe": self.cfg["entry_timeframe"],
                         "trade_mode": self.cfg["trade_mode"],
                         "ema": self.ema_params() if self.ema else None, "gate": self.learner.get("gate"),
                         "backtest": self.learner.get("ema_backtest"),
                         "gate_progress": self.learner.get("gate_progress"),
                         "research_progress": self.learner.get("research_progress"),
                "variations": self.learner.get("variations"),
                "forward": self.forward_view() if self.ema else [],
                         "charts_watched": len(self._universe or []),
                         "pending": list((self.risk.state.get("pending") or {}).values()),
                         "trades_today": self.trades_today() if self.ema else None},
                **({} if light else {"brain": self.brain.snapshot(), "seen": list(self.seen),
                                     "closed": self.learner.closed_trades(200),
                                     "closed_days": self.learner.closed_by_day(trading_day),
                                     "candidates": self.learner.candidates(12),
                                     "next_review": self.next_review_time(),
                                     "today": self.today_tally(status.get("open_trades") or []),
                                     "version": {"app": VERSION, "build": self._build,
                                                 "rules": self.learner.rules_version()},
                                     "closed_stats": {"day": self.learner.closed_summary(self.trading_day_start()),
                                                      "week": self.learner.closed_summary(self.clock() - 7 * 86400),
                                                      "all": self.learner.closed_summary(0)}})}

    def run_forever(self):
        log.info("bot started")
        while True:
            try:
                self.tick()
            except Exception as e:
                log.exception("tick failed: %s", e)
            time.sleep(self.cfg["poll_seconds"])
