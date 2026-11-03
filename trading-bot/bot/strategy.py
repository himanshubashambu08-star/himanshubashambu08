"""Trading rules. Change these to your own rules; the rest of the bot does not care
how a Signal is produced.

Default rule set: "trend pullback"
  1. Higher timeframe (HTF) trend: EMA fast > EMA slow and close > EMA slow  -> only buys
                                   EMA fast < EMA slow and close < EMA slow  -> only sells
  2. Entry timeframe (LTF): the previous closed candle tagged the pullback EMA,
     and the last closed candle closed back on the trend side of it, in the trend direction.
  3. RSI filter: buys only if RSI in [rsi_buy_min, rsi_buy_max]; sells mirrored.
  4. Stop distance = atr_stop_mult x ATR (entry timeframe).
Only COMPLETE candles are used, so a signal never peeks at an unfinished bar.
"""
from .indicators import atr, ema, rsi
from .models import Signal

DEFAULTS = {
    "htf_ema_fast": 50,
    "htf_ema_slow": 200,
    "ltf_ema_pullback": 20,
    "rsi_period": 14,
    "rsi_buy_min": 40, "rsi_buy_max": 70,
    "rsi_sell_min": 30, "rsi_sell_max": 60,
    "atr_period": 14,
    "atr_stop_mult": 1.5,
}


def _closed(candles):
    return [c for c in candles if c.complete]


def htf_bias(htf_candles, p):
    c = _closed(htf_candles)
    if len(c) < p["htf_ema_slow"] + 1:
        return 0
    closes = [x.c for x in c]
    fast, slow = ema(closes, p["htf_ema_fast"])[-1], ema(closes, p["htf_ema_slow"])[-1]
    if fast > slow and closes[-1] > slow:
        return 1
    if fast < slow and closes[-1] < slow:
        return -1
    return 0


def evaluate(instrument, htf_candles, ltf_candles, params=None):
    p = {**DEFAULTS, **(params or {})}
    bias = htf_bias(htf_candles, p)
    if bias == 0:
        return None
    c = _closed(ltf_candles)
    need = max(p["ltf_ema_pullback"], p["rsi_period"], p["atr_period"]) + 3
    if len(c) < need:
        return None
    closes = [x.c for x in c]
    e = ema(closes, p["ltf_ema_pullback"])
    r = rsi(closes, p["rsi_period"])[-1]
    a = atr([x.h for x in c], [x.l for x in c], closes, p["atr_period"])[-1]
    prev, last = c[-2], c[-1]
    e_prev, e_last = e[-2], e[-1]
    if None in (e_prev, e_last, r, a) or a <= 0:
        return None

    if bias == 1:
        tagged = prev.l <= e_prev
        rejected = last.c > e_last and last.c > last.o
        rsi_ok = p["rsi_buy_min"] <= r <= p["rsi_buy_max"]
    else:
        tagged = prev.h >= e_prev
        rejected = last.c < e_last and last.c < last.o
        rsi_ok = p["rsi_sell_min"] <= r <= p["rsi_sell_max"]

    if tagged and rejected and rsi_ok:
        side = "BUY" if bias == 1 else "SELL"
        return Signal(
            instrument=instrument,
            side=bias,
            stop_distance=p["atr_stop_mult"] * a,
            atr=a,
            reason=f"{side}: HTF trend + EMA{p['ltf_ema_pullback']} pullback, RSI {r:.0f}",
            time=last.time,
        )
    return None
