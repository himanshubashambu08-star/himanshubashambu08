import math

from bot.models import Candle


def trend_candles(n, start=2000.0, step=1.0, period_s=3600, t0=1_700_000_000, wiggle=0.0):
    """Steady trend with optional sine wiggle so pullbacks happen."""
    out, prev = [], start
    for i in range(n):
        c = start + step * i + wiggle * math.sin(i / 3)
        o = prev
        out.append(Candle(time=t0 + i * period_s, o=o, h=max(o, c) + 0.5, l=min(o, c) - 0.5, c=c))
        prev = c
    return out


def pullback_setup(side=1):
    """HTF trend + LTF series whose last two bars are: tag of EMA20, then a strong close back over it."""
    htf = trend_candles(260, step=2.0 * side, period_s=14400)
    ltf = trend_candles(60, start=2400, step=0.3 * side)
    last = ltf[-1].c
    t = ltf[-1].time
    # bar that dips back through the EMA (pullback), then a bar that closes back in trend direction
    dip = last - side * 6
    ltf.append(Candle(time=t + 3600, o=last, h=max(last, dip) + 0.2, l=min(last, dip) - 0.2, c=dip))
    rec = dip + side * 7
    ltf.append(Candle(time=t + 7200, o=dip, h=max(dip, rec) + 0.2, l=min(dip, rec) - 0.2, c=rec))
    return htf, ltf
