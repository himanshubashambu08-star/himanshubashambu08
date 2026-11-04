"""EMA 9/15 breakout strategy (XAU_USD, M5 by default). Live signal, chart reading and backtest
all use the same functions, so the backtest tests exactly what the bot trades.

Rules
  Trend      EMA9 > EMA15 -> only BUY;  EMA9 < EMA15 -> only SELL
  Alert      BUY: bullish candle whose LOW is above both EMAs (does not touch them)
             SELL: bearish candle whose HIGH is below both EMAs
  Entry      the NEXT candle must break the alert HIGH (SELL: LOW). If it does not, the setup is cancelled.
  Stop       alert LOW (SELL: alert HIGH).   Target: reward_risk x stop distance (3R)
  Skip       stop distance < 0.5 x ATR(14) or > 2 x ATR(14)
  Time       entry only inside the window (08:00-12:00 New York), max 2 trades per day
"""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from .indicators import atr, ema
from .models import Signal

NY = ZoneInfo("America/New_York")

DEFAULTS = {
    "ema_fast": 9,
    "ema_slow": 15,
    "atr_period": 14,
    "min_stop_atr": 0.5,
    "max_stop_atr": 2.0,
    "reward_risk": 3.0,
    "window_ny": [["08:00", "12:00"]],
    "max_trades_per_day": 2,
}


def _closed(candles):
    return [c for c in candles if c.complete]


def in_window(ts, windows):
    ny = datetime.fromtimestamp(ts, timezone.utc).astimezone(NY)
    if ny.weekday() >= 5:
        return False
    hm = ny.strftime("%H:%M")
    return any(a <= hm < b for a, b in windows)


def ny_day(ts):
    return datetime.fromtimestamp(ts, timezone.utc).astimezone(NY).date().isoformat()


def _alert(c, ef, es, a, p):
    """Side (+1/-1) if candle c is a valid alert candle, else 0."""
    if None in (ef, es, a) or a <= 0:
        return 0
    if ef > es and c.c > c.o and c.l > max(ef, es):
        side, dist = 1, c.h - c.l
    elif ef < es and c.c < c.o and c.h < min(ef, es):
        side, dist = -1, c.h - c.l
    else:
        return 0
    if not (p["min_stop_atr"] * a <= dist <= p["max_stop_atr"] * a):
        return 0
    return side


def series(candles, p):
    closes = [x.c for x in candles]
    return (ema(closes, p["ema_fast"]), ema(closes, p["ema_slow"]),
            atr([x.h for x in candles], [x.l for x in candles], closes, p["atr_period"]))


def evaluate(instrument, candles, params=None):
    """Signal when the LAST closed candle is an alert candle. Entry is a stop order at its high/low,
    valid only for the next candle."""
    p = {**DEFAULTS, **(params or {})}
    c = _closed(candles)
    if len(c) < max(p["ema_slow"], p["atr_period"]) + 3:
        return None
    ef, es, a = series(c, p)
    last = c[-1]
    side = _alert(last, ef[-1], es[-1], a[-1], p)
    if not side:
        return None
    entry, stop = (last.h, last.l) if side > 0 else (last.l, last.h)
    return Signal(
        instrument=instrument, side=side, stop_distance=abs(entry - stop), atr=a[-1],
        reason=f"{'BUY' if side > 0 else 'SELL'}: EMA{p['ema_fast']}{'>' if side > 0 else '<'}EMA{p['ema_slow']}, "
               f"alert candle EMA ko touch nahi kiya, entry {'high' if side > 0 else 'low'} break pe",
        time=last.time,
        features={"entry_ref": entry, "stop_atr": round(abs(entry - stop) / a[-1], 3),
                  "hour_ny": datetime.fromtimestamp(last.time, timezone.utc).astimezone(NY).hour},
        entry_price=entry, stop_price=stop,
    )


def read_chart(instrument, candles, params=None, bars=80):
    p = {**DEFAULTS, **(params or {})}
    c = _closed(candles)
    show = candles[-bars:]
    ref = candles[-1].c if candles else 1
    nd = 6 if abs(ref) < 20 else (4 if abs(ref) < 1000 else 2)
    out = {"instrument": instrument, "state": "none", "bias": 0, "score": 0, "note": "Abhi kaafi data nahi hai",
           "price": candles[-1].c if candles else None,
           "candles": [[int(x.time), round(x.o, nd), round(x.h, nd), round(x.l, nd), round(x.c, nd)] for x in show]}
    if len(c) < max(p["ema_slow"], p["atr_period"]) + 3:
        return out
    ef, es, a = series(c, p)
    n = len(show)
    out["ema"] = [round(v, nd + 1) if v is not None else None for v in ef[-n:]]
    while len(out["ema"]) < n:
        out["ema"].append(out["ema"][-1])
    last = c[-1]
    bias = 1 if ef[-1] > es[-1] else -1
    word = "BUY" if bias > 0 else "SELL"
    out.update(bias=bias, rsi=None, atr=a[-1], swing_high=max(x.h for x in c[-20:]), swing_low=min(x.l for x in c[-20:]))
    side = _alert(last, ef[-1], es[-1], a[-1], p)
    if side:
        trig, stop = (last.h, last.l) if side > 0 else (last.l, last.h)
        out.update(state="signal", score=100, zone=[round(min(trig, stop), nd), round(max(trig, stop), nd)],
                   stop_hint=round(stop, nd),
                   note=f"{word} alert candle! Agli candle {trig:.{nd}f} todhe to entry, SL {stop:.{nd}f}, TP 3R")
    else:
        gap = (last.l - max(ef[-1], es[-1])) if bias > 0 else (min(ef[-1], es[-1]) - last.h)
        if gap <= 0:
            out.update(state="forming", score=60,
                       note=f"EMA{p['ema_fast']} {'upar' if bias > 0 else 'neeche'} hai ({word} trend). Candle EMA ko chhoo rahi hai; "
                            f"EMA se door {'green' if bias > 0 else 'red'} candle ka intezaar")
        else:
            out.update(state="watch", score=30,
                       note=f"{word} trend chal raha hai, lekin abhi koi alert candle nahi")
    return out


ALL_DAY = [["00:00", "24:00"]]


def follow(side, trig, stop, rr, bars):
    """Shadow follow of one setup: bars[0] is the candle after the alert.
    Returns (r, bars_used) / ("cancel", 1) if the level was not broken / None if not finished yet."""
    if not bars:
        return None
    nxt = bars[0]
    if not (nxt.h >= trig if side > 0 else nxt.l <= trig):
        return "cancel", 1
    entry = max(nxt.o, trig) if side > 0 else min(nxt.o, trig)
    dist = abs(entry - stop)
    if dist <= 0:
        return "cancel", 1
    tp = entry + side * rr * dist
    for k, bar in enumerate(bars):
        if (bar.l <= stop) if side > 0 else (bar.h >= stop):
            return (stop - entry) * side / dist, k + 1
        if (bar.h >= tp) if side > 0 else (bar.l <= tp):
            return rr, k + 1
    return None


def backtest(candles, params=None, spread=0.0, windows=None):
    """Walk the history with the live rules. Trades: [{time, r, side, day}]. Spread is paid in R.
    Conservative: if stop and target are inside the same candle, the stop counts."""
    p = {**DEFAULTS, **(params or {})}
    windows = p["window_ny"] if windows is None else windows
    c = _closed(candles)
    if len(c) < 50:
        return []
    ef, es, a = series(c, p)
    rr = p["reward_risk"]
    trades, per_day, i = [], {}, max(p["ema_slow"], p["atr_period"]) + 2
    while i < len(c) - 1:
        side = _alert(c[i], ef[i], es[i], a[i], p)
        nxt = c[i + 1]
        if not side or not in_window(nxt.time, windows):
            i += 1
            continue
        day = ny_day(nxt.time)
        if per_day.get(day, 0) >= p["max_trades_per_day"]:
            i += 1
            continue
        trig, stop = (c[i].h, c[i].l) if side > 0 else (c[i].l, c[i].h)
        broke = nxt.h >= trig if side > 0 else nxt.l <= trig
        if not broke:
            i += 1
            continue
        entry = max(nxt.o, trig) if side > 0 else min(nxt.o, trig)     # a gap through the level fills worse
        dist = abs(entry - stop)
        if dist <= 0:
            i += 1
            continue
        tp = entry + side * rr * dist
        per_day[day] = per_day.get(day, 0) + 1
        r, j = None, i + 1
        while j < len(c):
            bar = c[j]
            hit_sl = bar.l <= stop if side > 0 else bar.h >= stop
            hit_tp = bar.h >= tp if side > 0 else bar.l <= tp
            if hit_sl:
                r = (stop - entry) * side / dist
                break
            if hit_tp:
                r = rr
                break
            j += 1
        if r is None:
            break
        trades.append({"time": nxt.time, "day": day, "side": side, "r": r - spread / dist,
                       "hour": datetime.fromtimestamp(nxt.time, timezone.utc).astimezone(NY).hour})
        i = j + 1
    return trades
