"""Simple bar-by-bar backtest of the strategy + exit rules, measured in R (1R = the risk on a trade).

Honest-by-default choices:
- Signal on a closed bar, entry at the NEXT bar's open (+ half spread).
- If stop and target are both inside the same bar, the stop is assumed to hit first.
- Breakeven move is applied from the bar AFTER the one that reached +1R.
- Trailing stop is not simulated (results are slightly conservative/different from live).
"""
from . import strategy
from .models import GRANULARITY_SECONDS


def run(instrument, htf, ltf, ltf_gran="H1", htf_gran="H4", params=None,
        reward_risk=2.0, breakeven_at_r=1.0, spread=0.0, window=300):
    ls, hs = GRANULARITY_SECONDS[ltf_gran], GRANULARITY_SECONDS[htf_gran]
    trades, pos, hi = [], None, 0
    for i in range(len(ltf) - 1):
        bar = ltf[i]
        if pos:
            stop_hit = (bar.l <= pos["stop"]) if pos["side"] > 0 else (bar.h >= pos["stop"])
            tp_hit = (bar.h >= pos["tp"]) if pos["side"] > 0 else (bar.l <= pos["tp"])
            if stop_hit:
                pos["exit"] = pos["stop"]
            elif tp_hit:
                pos["exit"] = pos["tp"]
            if "exit" in pos:
                pos["r"] = (pos["exit"] - pos["entry"]) * pos["side"] / pos["risk"]
                trades.append(pos)
                pos = None
            else:
                best = bar.h if pos["side"] > 0 else bar.l
                if (best - pos["entry"]) * pos["side"] >= breakeven_at_r * pos["risk"]:
                    if (pos["entry"] - pos["stop"]) * pos["side"] > 0:
                        pos["stop"] = pos["entry"]
        if pos:
            continue
        close_t = bar.time + ls
        while hi < len(htf) and htf[hi].time + hs <= close_t:
            hi += 1
        h_slice = htf[max(0, hi - window):hi]
        l_slice = ltf[max(0, i + 1 - window):i + 1]
        sig = strategy.evaluate(instrument, h_slice, l_slice, params)
        if not sig:
            continue
        nxt = ltf[i + 1]
        entry = nxt.o + sig.side * spread / 2
        stop = entry - sig.side * sig.stop_distance
        pos = {"side": sig.side, "entry": entry, "stop": stop, "risk": sig.stop_distance,
               "tp": entry + sig.side * reward_risk * sig.stop_distance, "time": nxt.time}
    return trades


def summary(trades):
    if not trades:
        return {"trades": 0}
    rs = [t["r"] for t in trades]
    wins = [r for r in rs if r > 0]
    losses = [r for r in rs if r < 0]
    eq = peak = dd = 0.0
    for r in rs:
        eq += r
        peak = max(peak, eq)
        dd = max(dd, peak - eq)
    return {
        "trades": len(rs),
        "win_rate_pct": round(100 * len(wins) / len(rs), 1),
        "total_R": round(sum(rs), 2),
        "avg_R": round(sum(rs) / len(rs), 3),
        "profit_factor": round(sum(wins) / -sum(losses), 2) if losses else None,
        "max_drawdown_R": round(dd, 2),
    }


def simulate(side, entry, stop_distance, bars, reward_risk=2.0, breakeven_at_r=1.0):
    """Follow one trade through the bars after entry, with the same rules as run().
    Returns (r, bars_held, max_favourable_r) or None if it has not finished yet."""
    stop = entry - side * stop_distance
    tp = entry + side * reward_risk * stop_distance
    best_r = 0.0
    for n, bar in enumerate(bars, 1):
        stop_hit = (bar.l <= stop) if side > 0 else (bar.h >= stop)
        tp_hit = (bar.h >= tp) if side > 0 else (bar.l <= tp)
        if stop_hit:
            return (stop - entry) * side / stop_distance, n, best_r
        if tp_hit:
            return reward_risk, n, max(best_r, reward_risk)
        fav = ((bar.h - entry) if side > 0 else (entry - bar.l)) / stop_distance
        best_r = max(best_r, fav)
        if fav >= breakeven_at_r and (entry - stop) * side > 0:
            stop = entry
    return None


def signals(instrument, htf, ltf, ltf_gran="H1", htf_gran="H4", params=None, window=300):
    """Every base signal on the history (no confirmation, positions ignored): [(bar_index, Signal)].
    The expensive part, done once per instrument; variants are then simulated cheaply from it."""
    ls, hs = GRANULARITY_SECONDS[ltf_gran], GRANULARITY_SECONDS[htf_gran]
    p = {**(params or {}), "confirm_candles": 0}
    out, hi = [], 0
    for i in range(len(ltf) - 2):
        close_t = ltf[i].time + ls
        while hi < len(htf) and htf[hi].time + hs <= close_t:
            hi += 1
        sig = strategy.evaluate(instrument, htf[max(0, hi - window):hi], ltf[max(0, i + 1 - window):i + 1], p)
        if sig:
            out.append((i, sig))
    return out


def variant(ltf, sigs, confirm=0, stop_mult=1.5, reward_risk=2.0, breakeven_at_r=1.0, spread=0.0):
    """Trades for one rule variant. Spread is paid on every trade (in R), one position at a time."""
    trades, busy = [], -1
    for i, sig in sigs:
        if i <= busy:
            continue
        j = i
        if confirm:
            if i + 1 >= len(ltf) or (ltf[i + 1].c - ltf[i].c) * sig.side <= 0:
                continue
            j = i + 1
        if j + 1 >= len(ltf):
            break
        dist = stop_mult * sig.atr
        if dist <= 0:
            continue
        entry = ltf[j + 1].o
        res = simulate(sig.side, entry, dist, ltf[j + 1:], reward_risk, breakeven_at_r)
        if res is None:
            break
        r, bars, _ = res
        trades.append({"time": ltf[j + 1].time, "r": r - spread / dist, "side": sig.side})
        busy = j + bars
    return trades
