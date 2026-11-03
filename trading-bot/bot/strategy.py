"""Trading rules + chart reader.

Default rule set: "trend pullback"
  1. Higher timeframe (HTF) trend: EMA fast > EMA slow and close > EMA slow  -> only buys
                                   EMA fast < EMA slow and close < EMA slow  -> only sells
  2. Entry timeframe (LTF): the previous closed candle tagged the pullback EMA,
     and the last closed candle closed back on the trend side of it, in the trend direction.
  3. RSI filter: buys only if RSI in [rsi_buy_min, rsi_buy_max]; sells mirrored.
  4. Stop distance = atr_stop_mult x ATR (entry timeframe).
Only COMPLETE candles are used for signals, so a signal never peeks at an unfinished bar.

read_chart() is the "chart reader" used by the dashboard: for any chart it says whether there is a
signal now, a setup forming (price coming into the pullback zone), a trend to watch, or nothing.
"""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from .indicators import atr, ema, rsi
from .models import Signal

NY = ZoneInfo("America/New_York")

DEFAULTS = {
    "htf_ema_fast": 50,
    "htf_ema_slow": 200,
    "ltf_ema_pullback": 20,
    "rsi_period": 14,
    "rsi_buy_min": 40, "rsi_buy_max": 70,
    "rsi_sell_min": 30, "rsi_sell_max": 60,
    "atr_period": 14,
    "atr_stop_mult": 1.5,
    "forming_atr": 1.0,      # chart reader: within this many ATR of the EMA = "forming"
}


def _closed(candles):
    return [c for c in candles if c.complete]


def _htf(htf_candles, p):
    """(bias, trend_strength). Strength = EMA gap as % of price."""
    c = _closed(htf_candles)
    if len(c) < p["htf_ema_slow"] + 1:
        return 0, 0.0
    closes = [x.c for x in c]
    fast, slow = ema(closes, p["htf_ema_fast"])[-1], ema(closes, p["htf_ema_slow"])[-1]
    strength = abs(fast - slow) / closes[-1] * 100
    if fast > slow and closes[-1] > slow:
        return 1, strength
    if fast < slow and closes[-1] < slow:
        return -1, strength
    return 0, strength


def htf_bias(htf_candles, p):
    return _htf(htf_candles, {**DEFAULTS, **p})[0]


def _ltf(c, p):
    need = max(p["ltf_ema_pullback"], p["rsi_period"], p["atr_period"]) + 3
    if len(c) < need:
        return None
    closes = [x.c for x in c]
    e = ema(closes, p["ltf_ema_pullback"])
    r = rsi(closes, p["rsi_period"])[-1]
    a = atr([x.h for x in c], [x.l for x in c], closes, p["atr_period"])[-1]
    if None in (e[-1], e[-2], r, a) or a <= 0:
        return None
    return {"ema": e, "rsi": r, "atr": a}


def evaluate(instrument, htf_candles, ltf_candles, params=None):
    p = {**DEFAULTS, **(params or {})}
    bias, strength = _htf(htf_candles, p)
    if bias == 0:
        return None
    c = _closed(ltf_candles)
    x = _ltf(c, p)
    if not x:
        return None
    e, r, a = x["ema"], x["rsi"], x["atr"]
    prev, last = c[-2], c[-1]

    if bias == 1:
        tagged = prev.l <= e[-2]
        rejected = last.c > e[-1] and last.c > last.o
        rsi_ok = p["rsi_buy_min"] <= r <= p["rsi_buy_max"]
    else:
        tagged = prev.h >= e[-2]
        rejected = last.c < e[-1] and last.c < last.o
        rsi_ok = p["rsi_sell_min"] <= r <= p["rsi_sell_max"]

    if not (tagged and rejected and rsi_ok):
        return None
    close_time = last.time + (last.time - prev.time)
    ny = datetime.fromtimestamp(close_time, timezone.utc).astimezone(NY)
    side = "BUY" if bias == 1 else "SELL"
    return Signal(
        instrument=instrument, side=bias, stop_distance=p["atr_stop_mult"] * a, atr=a,
        reason=f"{side}: HTF trend + EMA{p['ltf_ema_pullback']} pullback, RSI {r:.0f}",
        time=last.time,
        features={
            "hour_ny": ny.hour, "dow": ny.weekday(),
            "rsi": round(r, 1),
            "trend_strength": round(strength, 3),
            "dist_ema_atr": round((last.c - e[-1]) * bias / a, 3),
            "body_atr": round(abs(last.c - last.o) / a, 3),
            "atr_pct": round(a / last.c * 100, 4),
            "entry_ref": last.c,
        },
    )


def read_chart(instrument, htf_candles, ltf_candles, params=None, bars=80):
    """Plain-language reading of one chart for the dashboard."""
    p = {**DEFAULTS, **(params or {})}
    bias, strength = _htf(htf_candles, p)
    closed = _closed(ltf_candles)
    x = _ltf(closed, p)
    out = {"instrument": instrument, "state": "none", "bias": bias, "score": 0,
           "note": "Not enough data", "price": ltf_candles[-1].c if ltf_candles else None}
    show = ltf_candles[-bars:]
    out["candles"] = [[c.time, c.o, c.h, c.l, c.c] for c in show]
    if not x:
        return out
    e, r, a = x["ema"], x["rsi"], x["atr"]
    price = ltf_candles[-1].c
    ema_now = e[-1]
    dec = 5 if price < 20 else (3 if price < 1000 else 2)
    out["ema"] = [round(v, dec + 1) if v is not None else None for v in e[-len(show):]]
    # pad when the live (incomplete) candle is shown
    while len(out["ema"]) < len(show):
        out["ema"].append(round(ema_now, dec + 1))
    look = closed[-20:]
    out.update(rsi=round(r, 1), atr=a, swing_high=max(c.h for c in look), swing_low=min(c.l for c in look),
               trend_strength=round(strength, 3))

    if bias == 0:
        out.update(state="none", score=0, note="No clear trend on the higher timeframe - sit out")
        return out

    zone = (ema_now - 0.25 * a, ema_now + 0.25 * a)
    out["zone"] = [round(zone[0], dec), round(zone[1], dec)]
    out["stop_hint"] = round(ema_now - bias * p["atr_stop_mult"] * a, dec)
    dist = (price - ema_now) * bias / a           # >0 = on the trend side of the EMA
    word = "Buy" if bias == 1 else "Sell"
    trend = "Uptrend" if bias == 1 else "Downtrend"
    out["dist_atr"] = round(dist, 2)

    if evaluate(instrument, htf_candles, ltf_candles, p):
        out.update(state="signal", score=100,
                   note=f"{word} signal now: pullback to EMA{p['ltf_ema_pullback']} rejected, RSI {r:.0f}")
    elif -0.5 <= dist <= p["forming_atr"]:
        out.update(state="forming", score=round(60 + 30 * (1 - max(dist, 0) / p["forming_atr"])),
                   note=f"{trend}: price {dist:.1f} ATR from the EMA. {word} zone forming at "
                        f"{zone[0]:.{dec}f}-{zone[1]:.{dec}f}; wait for a rejection candle")
    elif dist > p["forming_atr"]:
        out.update(state="watch", score=round(max(5, 40 - 5 * dist)),
                   note=f"{trend} but stretched ({dist:.1f} ATR away). {word} only on a pullback "
                        f"near {ema_now:.{dec}f}")
    else:
        out.update(state="watch", score=10,
                   note=f"{trend} on HTF, but price is {abs(dist):.1f} ATR through the EMA - trend may be breaking")
    return out
