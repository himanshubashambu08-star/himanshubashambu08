"""Self-learning memory.

Every signal the bot sees is stored with the conditions at that moment (hour, RSI, trend strength,
spread, how stretched price was...). That includes signals it did NOT take (blocked by a rule,
outside the US session, risk limits). Each one is then followed on the real chart until it would
have hit the stop or the target, so the bot learns from every chart, not only from its own trades.

Once per trading day (after 17:00 New York) daily_review():
  1. Labels the mistakes in losing trades (stopped out fast, gave back profit, chased a big candle...).
  2. Finds conditions that keep losing money (enough samples + statistically below zero) and
     switches on a filter to avoid them. A filter switches itself off again when the shadow
     results for that condition turn positive.
  3. Tunes ONE strategy setting a small step at a time, with a walk-forward test: the new value
     must beat the current one on older data AND not be worse on the most recent unseen data.
  4. Writes a plain-language report to reports/YYYY-MM-DD.md.
It never touches risk per trade, the daily loss limit or the drawdown limit.
"""
import json
import math
import os
import sqlite3
import threading
import time

from . import backtest

DEFAULTS = {
    "min_samples": 20,          # never learn from fewer trades than this
    "window_days": 90,          # look back this far
    "margin_r": 0.25,           # a condition must be this much worse than normal to be filtered
    "tune": True,
    "tune_bars": 3000,
    "tune_instruments": 8,
    "test_fraction": 0.3,       # most recent 30% of history = unseen test data
    "reports_dir": "reports",
}

# conditions the learner may switch on as filters: name -> (test, plain words)
CONDITIONS = {
    "weak_trend": (lambda f, s: f.get("trend_strength", 9) < 0.15, "higher-timeframe trend was weak"),
    "overextended_rsi": (lambda f, s: (f.get("rsi", 50) > 65) if s > 0 else (f.get("rsi", 50) < 35),
                         "RSI was already stretched in the trade direction"),
    "far_from_ema": (lambda f, s: f.get("dist_ema_atr", 0) > 0.8, "entry was far from the EMA (late entry)"),
    "big_candle_chase": (lambda f, s: f.get("body_atr", 0) > 1.5, "entered after a very big candle (chasing)"),
    "wide_spread": (lambda f, s: f.get("spread_ratio", 0) > 0.08, "spread was large compared with the stop"),
    "late_session": (lambda f, s: f.get("hour_ny", 12) >= 15, "entry late in the New York session"),
    "early_session": (lambda f, s: f.get("hour_ny", 12) < 9, "entry in the first hour of New York"),
    "friday": (lambda f, s: f.get("dow") == 4, "Friday entry"),
}

MISTAKE_WORDS = {
    "stopped_fast": "stopped out within 2 candles: entry too early, wait for more confirmation",
    "gave_back": "was +1R or more, then closed at 0 or a loss",
    **{k: v[1] for k, v in CONDITIONS.items()},
}

# settings the learner may tune: (min, max, step)
TUNABLE = {
    "atr_stop_mult": (1.0, 3.0, 0.25),
    "ltf_ema_pullback": (10, 50, 5),
    "rsi_buy_min": (30, 50, 5),
    "rsi_sell_max": (50, 70, 5),
    "reward_risk": (1.0, 3.0, 0.5),
}


def _dyn_conditions(row):
    return [f"instrument:{row['instrument']}", f"hour:{row['features'].get('hour_ny')}"]


def matches(name, row):
    f, s = row["features"], row["side"]
    if name in CONDITIONS:
        return bool(CONDITIONS[name][0](f, s))
    if name.startswith("instrument:"):
        return row["instrument"] == name.split(":", 1)[1]
    if name.startswith("hour:"):
        return str(f.get("hour_ny")) == name.split(":", 1)[1]
    return False


def describe(name):
    if name in MISTAKE_WORDS:
        return MISTAKE_WORDS[name]
    k, v = name.split(":", 1)
    return f"trading {v}" if k == "instrument" else f"entries at {v}:00 New York"


def tag_mistakes(row, r, bars_held, max_r):
    tags = []
    if r < 0 and bars_held <= 2:
        tags.append("stopped_fast")
    if max_r >= 1.0 and r <= 0:
        tags.append("gave_back")
    if r < 0:
        tags += [c for c in CONDITIONS if matches(c, row)]
    return tags


def _mean_se(xs):
    n = len(xs)
    m = sum(xs) / n
    var = sum((x - m) ** 2 for x in xs) / (n - 1) if n > 1 else 0.0
    return m, math.sqrt(var / n) if n else 0.0


class Learner:
    def __init__(self, params=None, path=":memory:", clock=time.time):
        self.p = {**DEFAULTS, **(params or {})}
        self.clock = clock
        self.lock = threading.Lock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS signals(
              id INTEGER PRIMARY KEY, instrument TEXT, side INTEGER, time REAL, entry REAL,
              stop_dist REAL, features TEXT, taken INTEGER, skip_reason TEXT, trade_id TEXT,
              status TEXT DEFAULT 'open', r REAL, bars_held INTEGER, max_r REAL,
              real_r REAL, mistakes TEXT);
            CREATE TABLE IF NOT EXISTS lessons(day TEXT, kind TEXT, text TEXT, data TEXT);
            CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT);
        """)

    # ---- key/value ---------------------------------------------------
    def get(self, key, default=None):
        with self.lock:
            row = self.db.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def put(self, key, value):
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO kv VALUES(?,?)", (key, json.dumps(value)))
            self.db.commit()

    def params(self):
        return self.get("params", {})

    def filters(self):
        return self.get("filters", [])

    # ---- recording ---------------------------------------------------
    def record_signal(self, sig, taken, skip_reason=None, trade_id=None, entry=None):
        with self.lock:
            cur = self.db.execute(
                "INSERT INTO signals(instrument, side, time, entry, stop_dist, features, taken, skip_reason, trade_id)"
                " VALUES(?,?,?,?,?,?,?,?,?)",
                (sig.instrument, sig.side, sig.time, entry or sig.features.get("entry_ref"),
                 sig.stop_distance, json.dumps(sig.features), int(taken), skip_reason,
                 str(trade_id) if trade_id else None))
            self.db.commit()
            return cur.lastrowid

    def blocked(self, sig):
        row = {"instrument": sig.instrument, "side": sig.side, "features": sig.features}
        for name in self.filters():
            if matches(name, row):
                return f"learned filter: avoid {describe(name)}"
        return None

    def _rows(self, where, args=()):
        with self.lock:
            rows = self.db.execute(f"SELECT * FROM signals WHERE {where}", args).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["features"] = json.loads(d["features"] or "{}")
            d["mistakes"] = json.loads(d["mistakes"] or "[]")
            out.append(d)
        return out

    def resolve(self, instrument, candles, gran_seconds, reward_risk=2.0, breakeven_at_r=1.0):
        """Follow every unfinished signal of this instrument on the chart."""
        done = 0
        closed = [c for c in candles if c.complete]
        for row in self._rows("instrument=? AND status='open'", (instrument,)):
            after = [c for c in closed if c.time >= row["time"] + gran_seconds]
            if not after:
                if closed and closed[0].time > row["time"] + gran_seconds:
                    self._update(row["id"], status="expired")
                continue
            entry = after[0].o if not row["taken"] else row["entry"]
            res = backtest.simulate(row["side"], entry, row["stop_dist"], after, reward_risk, breakeven_at_r)
            if res is None:
                continue
            r, bars, max_r = res
            self._update(row["id"], status="done", r=r, bars_held=bars, max_r=max_r,
                         mistakes=json.dumps(tag_mistakes(row, r, bars, max_r)))
            done += 1
        return done

    def set_real_result(self, trade_id, real_r):
        with self.lock:
            self.db.execute("UPDATE signals SET real_r=? WHERE trade_id=?", (real_r, str(trade_id)))
            self.db.commit()

    def _update(self, rid, **kw):
        cols = ", ".join(f"{k}=?" for k in kw)
        with self.lock:
            self.db.execute(f"UPDATE signals SET {cols} WHERE id=?", (*kw.values(), rid))
            self.db.commit()

    def lesson(self, day, kind, text, data=None):
        with self.lock:
            self.db.execute("INSERT INTO lessons VALUES(?,?,?,?)", (day, kind, text, json.dumps(data or {})))
            self.db.commit()

    def lessons(self, limit=20):
        with self.lock:
            rows = self.db.execute("SELECT * FROM lessons ORDER BY rowid DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    # ---- learning: filters --------------------------------------------
    def learn_filters(self, day):
        since = self.clock() - self.p["window_days"] * 86400
        rows = self._rows("status='done' AND time>=?", (since,))
        names = set(CONDITIONS)
        for r in rows:
            names.update(_dyn_conditions(r))
        active = set(self.filters())
        changes = []
        for name in sorted(names):
            w = [r["r"] for r in rows if matches(name, r)]
            wo = [r["r"] for r in rows if not matches(name, r)]
            if len(w) < self.p["min_samples"]:
                continue
            m, se = _mean_se(w)
            base = sum(wo) / len(wo) if wo else 0.0
            if name not in active and m + se < 0 and m < base - self.p["margin_r"]:
                active.add(name)
                changes.append(("filter_on", name, m, len(w), base))
            elif name in active and m > 0:
                active.discard(name)
                changes.append(("filter_off", name, m, len(w), base))
        self.put("filters", sorted(active))
        for kind, name, m, n, base in changes:
            if kind == "filter_on":
                txt = (f"New rule: avoid {describe(name)}. Over {n} setups it averaged {m:+.2f}R "
                       f"vs {base:+.2f}R for the rest.")
            else:
                txt = (f"Rule removed: {describe(name)} is now averaging {m:+.2f}R over {n} setups, "
                       f"so it is allowed again.")
            self.lesson(day, kind, txt, {"condition": name, "avg_r": m, "n": n})
        return changes

    # ---- learning: parameter tuning (walk-forward) ----------------------
    def tune(self, day, history, base_params, base_rr, instruments, breakeven_at_r=1.0):
        """history(instrument) -> (htf, ltf). Changes at most one setting by one step."""
        if not self.p["tune"] or not instruments:
            return None
        data = []
        for n in instruments[: self.p["tune_instruments"]]:
            try:
                htf, ltf = history(n)
            except Exception:
                continue
            if len(ltf) > 400:
                data.append((n, htf, ltf))
        if not data:
            return None
        cur = {**base_params, **self.params()}
        cur_rr = cur.pop("reward_risk", base_rr)

        def score(params, rr):
            train = test = 0.0
            n_train = 0
            for name, htf, ltf in data:
                split = ltf[int(len(ltf) * (1 - self.p["test_fraction"]))].time
                for t in backtest.run(name, htf, ltf, params=params, reward_risk=rr,
                                      breakeven_at_r=breakeven_at_r):
                    if t["time"] < split:
                        train += t["r"]
                        n_train += 1
                    else:
                        test += t["r"]
            return train, test, n_train

        from .strategy import DEFAULTS as SD
        base = score(cur, cur_rr)
        best = None
        for key, (lo, hi, step) in TUNABLE.items():
            now = cur_rr if key == "reward_risk" else cur.get(key, SD.get(key))
            for new in (now - step, now + step):
                if not lo <= new <= hi:
                    continue
                new = int(new) if isinstance(step, int) else round(new, 4)
                params, rr = dict(cur), cur_rr
                if key == "reward_risk":
                    rr = new
                else:
                    params[key] = new
                tr, te, n = score(params, rr)
                gain_needed = max(2.0, 0.1 * abs(base[0]))
                if n >= self.p["min_samples"] and tr >= base[0] + gain_needed and te >= base[1] and te > 0:
                    if best is None or tr > best[2]:
                        best = (key, new, tr, te, now)
        if not best:
            self.lesson(day, "tune", f"Checked {len(TUNABLE) * 2} small setting changes on "
                        f"{len(data)} charts; none beat the current settings on unseen data. No change.",
                        {"train_r": base[0], "test_r": base[1]})
            return None
        key, new, tr, te, old = best
        learned = self.params()
        learned[key] = new
        self.put("params", learned)
        self.lesson(day, "tune", f"Setting {key}: {old} -> {new}. Older data {base[0]:+.1f}R -> {tr:+.1f}R, "
                    f"unseen recent data {base[1]:+.1f}R -> {te:+.1f}R.",
                    {"key": key, "old": old, "new": new})
        return best

    # ---- daily review --------------------------------------------------
    def daily_review(self, day, history=None, base_params=None, base_rr=2.0, instruments=(),
                     breakeven_at_r=1.0):
        since = self.clock() - 86400 * 1.5
        recent = self._rows("status='done' AND time>=?", (since,))
        counts = {}
        for r in recent:
            for m in r["mistakes"]:
                counts[m] = counts.get(m, 0) + 1
        changes = self.learn_filters(day)
        tuned = self.tune(day, history, base_params or {}, base_rr, list(instruments), breakeven_at_r) \
            if history else None
        self.put("last_review_day", day)
        self._write_report(day, recent, counts)
        return {"mistakes": counts, "filter_changes": changes, "tuned": tuned}

    def _write_report(self, day, recent, counts):
        taken = [r for r in recent if r["taken"]]
        shadow = [r for r in recent if not r["taken"]]

        def line(rows):
            if not rows:
                return "none"
            rs = [r["real_r"] if r["real_r"] is not None else r["r"] for r in rows]
            wins = sum(1 for x in rs if x > 0)
            return f"{len(rs)} trades, {wins} wins, total {sum(rs):+.2f}R"

        lines = [f"# Daily review {day}", "",
                 f"- Bot trades: {line(taken)}",
                 f"- Setups it watched but skipped: {line(shadow)}", "", "## Mistakes found"]
        lines += [f"- {n} x {MISTAKE_WORDS.get(k, k)}" for k, n in sorted(counts.items(), key=lambda x: -x[1])] \
            or ["- none"]
        lines += ["", "## What changed today"]
        today = [l for l in self.lessons(50) if l["day"] == day]
        lines += [f"- {l['text']}" for l in reversed(today)] or ["- nothing"]
        lines += ["", "## Active learned rules"]
        lines += [f"- avoid {describe(f)}" for f in self.filters()] or ["- none"]
        lines += ["", "## Learned settings", f"- {json.dumps(self.params()) if self.params() else 'defaults'}"]
        os.makedirs(self.p["reports_dir"], exist_ok=True)
        with open(os.path.join(self.p["reports_dir"], f"{day}.md"), "w") as f:
            f.write("\n".join(lines) + "\n")

    # ---- dashboard ------------------------------------------------------
    def snapshot(self):
        since = self.clock() - 30 * 86400
        rows = self._rows("status='done' AND time>=?", (since,))
        counts = {}
        for r in rows:
            for m in r["mistakes"]:
                counts[m] = counts.get(m, 0) + 1
        taken = [r for r in rows if r["taken"]]
        return {
            "filters": [{"name": f, "text": describe(f)} for f in self.filters()],
            "params": self.params(),
            "lessons": [{"day": l["day"], "text": l["text"]} for l in self.lessons(10)],
            "mistakes_30d": [{"text": MISTAKE_WORDS.get(k, describe(k)), "count": n}
                             for k, n in sorted(counts.items(), key=lambda x: -x[1])[:8]],
            "stats_30d": {
                "setups_followed": len(rows),
                "bot_trades": len(taken),
                "bot_total_r": round(sum((r["real_r"] if r["real_r"] is not None else r["r"]) for r in taken), 2),
                "all_setups_total_r": round(sum(r["r"] for r in rows), 2),
            },
        }
