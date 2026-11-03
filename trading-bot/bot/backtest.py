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
