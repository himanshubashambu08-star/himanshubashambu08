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
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from . import strategy
from .agents import AgentLog
from .journal import Journal
from .learner import Learner, MISTAKE_WORDS, describe
from .models import GRANULARITY_SECONDS
from .news import NewsCalendar
from .risk import RiskManager

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


def pair(name):
    return name.replace("_", "/")


def side_word(side):
    return "BUY" if side > 0 else "SELL"


def ny_time(ts):
    return datetime.fromtimestamp(ts, timezone.utc).astimezone(NY).strftime("%H:%M")


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
    if r.startswith("too much ") and r.endswith(" exposure"):
        return f"{r[9:-9]} mein pehle se kaafi trades hain (ek currency pe zyada risk nahi)"
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
                 agents_path=None, news_path=None, news_fetcher=None, clock=time.time):
        self.broker = broker
        self.cfg = {**DEFAULTS, **config.get("engine", {})}
        self.base_params = config.get("strategy", {})
        self.risk = RiskManager(config.get("risk", {}), state_path)
        self.journal = Journal(journal_path)
        self.learner = Learner(config.get("learning", {}), memory_path, clock=clock)
        self.agents = AgentLog(agents_path, clock=clock)
        self.news = NewsCalendar(config.get("news", {}), news_path, clock=clock, fetcher=news_fetcher)
        self._news_active = set()
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

    def reward_risk(self):
        return self.learner.params().get("reward_risk", self.risk.p["reward_risk"])

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

    def why_no_new_trades(self, now):
        if self.risk.halted:
            return self.risk.halted
        if os.path.exists(self.cfg["kill_file"]):
            return "STOP switch ON (kill file)"
        if self._in_blackout(now):
            return "news blackout"
        if not self.in_session(now):
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
        for inst in self.universe():
            try:
                ltf = self.broker.candles(inst.name, tf_name, n)
                htf = self.broker.candles(inst.name, self.cfg["trend_timeframe"], n)
                board[inst.name] = strategy.read_chart(inst.name, htf, ltf, params)
                if look_for_trades:
                    if self.cfg["learn"]:
                        self.learner.resolve(inst.name, ltf, tf_s, self.reward_risk(), self.cfg["breakeven_at_r"])
                        self.report_resolved()
                    sig = strategy.evaluate(inst.name, htf, ltf, params)
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
            f"{pair(r['instrument'])} {'buy' if r['bias'] > 0 else 'sell'} zone {r['zone'][0]}–{r['zone'][1]}"
            for r in forming[:4]) if forming else "Abhi koi setup banta nahi dikh raha. Har minute dobara padhega.")
        p = {**strategy.DEFAULTS, **params}
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
            A.journey_start(ref, inst.name, sig.side, sig.time, sig.reason)
            f = sig.features
            A.step(ref, "scanner", "pass", f"{pair(inst.name)} ka {tf_name} candle {ny_time(sig.time + tf_s)} pe close hua")
            A.step(ref, "reader", "pass", f"Chart pe signal dikha")
            A.step(ref, "rules", "pass", f"✓ H4 trend {'up' if sig.side > 0 else 'down'} · ✓ EMA pullback + rejection · "
                   f"✓ RSI {f.get('rsi')} · SL distance {sig.stop_distance:.5g}")
            A.count("rules", "passed")
            A.did("rules", f"{pair(inst.name)} {side_word(sig.side)}: saare rules poore (RSI {f.get('rsi')})", ref, "good")
            A.handoff("rules", "timer", f"{pair(inst.name)} {side_word(sig.side)} timing check ke liye", ref)
            self.try_open(inst, sig, account, blocked_now)
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
               f"spread SL ke {int(rp['max_spread_to_stop'] * 100)}% se kam · daily loss {rp['daily_loss_limit_pct']}% · "
               f"max drawdown {rp['max_drawdown_pct']}%")
        A.status("executor", f"Aaj {ec.get('orders', 0)} orders lage", "ok" if ec.get("orders") else "idle")
        A.plan("executor", "Risk Manager se approve hote hi market order, SL aur TP ek saath broker pe. "
               "Fail hua to dobara nahi bhejta (double order se bachne ke liye).")

        with self.lock:
            self.board = board
            self.status = {
                "time": now, "nav": account.nav, "balance": account.balance, "currency": account.currency,
                "day_start_nav": self.risk.state.get("day_start_nav"),
                "open_trades": [t.__dict__ for t in self.broker.open_trades()],
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
            ev = None if blocked_now else self.news.blocking(inst.name, self.clock())
            reason = blocked_now or (f"news: {ev['currency']} {ev['title']} {ny_time(ev['time'])} NY (High)" if ev else None) \
                or (self.learner.blocked(sig) if self.cfg["learn"] else None)
            if reason:
                return self._skip(inst, sig, "timer", reason)
            A.step(ref, "timer", "pass", "GO: US session khula, news blackout nahi, koi seekha hua rule nahi roka")
            A.count("timer", "go")
            A.did("timer", f"{name} {side_word(sig.side)}: GO", ref, "good")
            A.handoff("timer", "risk", f"{name} size aur limits ke liye", ref)

            # Risk Manager
            ok, why = self.risk.can_open(sig, self.broker.open_trades(), price)
            if not ok:
                return self._skip(inst, sig, "risk", why)
            units = self.risk.size(account.balance, sig.stop_distance, self.broker.quote_to_home(inst.name), inst)
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
            entry = price.ask if sig.side > 0 else price.bid
            stop = entry - sig.side * sig.stop_distance
            tp = entry + sig.side * rr * sig.stop_distance
            trade = self.broker.market_order(inst.name, sig.side * units, stop, tp)
            self.risk.remember(trade.id, trade.entry, stop, sig.atr)
            self.known_trades[str(trade.id)] = inst.name
            A.trade_refs[str(trade.id)] = ref
            if self.cfg["learn"]:
                self.learner.record_signal(sig, taken=True, trade_id=trade.id, entry=trade.entry)
            A.step(ref, "executor", "pass", f"Order laga: {side_word(sig.side)} {units:g} @ {trade.entry:.5g} · "
                   f"SL {stop:.5g} · TP {tp:.5g} ({rr}R)")
            A.mark(ref, taken=True, state="trade open", trade_id=str(trade.id))
            A.count("executor", "orders")
            A.did("executor", f"{name} {side_word(sig.side)} {units:g} @ {trade.entry:.5g} · SL {stop:.5g} · TP {tp:.5g}",
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
    def _spot_closed(self, open_trades):
        A = self.agents
        open_ids = {str(t.id) for t in open_trades}
        for tid in [t for t in self.known_trades if t not in open_ids]:
            inst = self.known_trades.pop(tid)
            info = self.risk.state["trades"].get(tid)
            ref = A.trade_refs.get(tid)
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
                word = "TARGET 🎯" if r > 0.5 else ("breakeven" if abs(r) < 0.05 else ("STOP LOSS" if r < 0 else "profit"))
                A.did("manager", f"{pair(inst)} close @ {px:.5g}: {r:+.2f}R ({word})", ref,
                      "good" if r > 0 else ("bad" if r < 0 else "info"))
                A.count("manager", "closed")
                A.count("manager", "r_x100", int(round(r * 100)))
                A.step(ref, "manager", "pass", f"Trade close @ {px:.5g}: {r:+.2f}R ({word})")
                A.mark(ref, state="khatam", result=f"{r:+.2f}R", r=round(r, 2))
                A.handoff("manager", "learner", f"{pair(inst)} ka result {r:+.2f}R seekhne ko", ref)
                self.journal.write("close", inst, side, entry=info["entry"], note=f"{r:+.2f}R exit {px}")
                log.info("CLOSED %s %s %+.2fR", inst, tid, r)

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
                    A.did("manager", f"{pair(t.instrument)} SL {what}: {new_stop:.5g} (+{progress:.2f}R)", ref, "good")
                    A.step(ref, "manager", "info", f"SL {what} → {new_stop:.5g} jab trade +{progress:.2f}R tha")
                    A.count("manager", "sl_moves")
                    self.journal.write("move_sl", t.instrument, t.side, stop=new_stop, note=f"+{progress:.2f}R")
                    log.info("SL %s %s -> %s (+%.2fR)", t.instrument, t.id, new_stop, progress)
                except Exception as e:
                    log.error("move SL %s failed: %s", t.id, e)
        mine = [t for t in trades if str(t.id) in self.risk.state["trades"]]
        A.status("manager", f"{len(mine)} open trade" + ("s" if len(mine) != 1 else ""), "ok" if mine else "idle")
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
            who = "bot ka trade" if row["taken"] else "chhoda hua setup"
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

    def review(self, day):
        log.info("daily review for %s", day)
        A = self.agents
        n = self.learner.p["tune_bars"]

        def history(name):
            return (self.broker.candles(name, self.cfg["trend_timeframe"], n),
                    self.broker.candles(name, self.cfg["entry_timeframe"], n))
        try:
            before = len(self.learner.lessons(500))
            out = self.learner.daily_review(day, history, self.params(), self.reward_risk(),
                                            [i.name for i in self.universe()], self.cfg["breakeven_at_r"])
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
        except Exception as e:
            log.exception("review failed: %s", e)
            A.did("learner", f"Review fail: {e}", tone="bad")

    # ---- dashboard -----------------------------------------------------
    def snapshot(self):
        with self.lock:
            charts = sorted(self.board.values(), key=lambda r: -r.get("score", 0))
            status = dict(self.status)
        return {"status": status, "charts": charts, "learning": self.learner.snapshot(),
                "news": self.news_list(self.clock()), "news_error": self.news.error,
                "journal": self.journal.rows[-30:][::-1], **self.agents.snapshot()}

    def run_forever(self):
        log.info("bot started")
        while True:
            try:
                self.tick()
            except Exception as e:
                log.exception("tick failed: %s", e)
            time.sleep(self.cfg["poll_seconds"])
