---
name: chart-scanner
description: Read a gold (MGC/GC/XAUUSD) chart screenshot and return trend, key levels, the setup if any, and an A/B/C grade. Use when the user shares a chart image or asks "scan this chart".
---

# Chart Scanner

The user gives a chart screenshot (or a description). Look at it carefully and answer in this order.
Use short, plain sentences. If something is not visible in the image, say so; never invent prices.

1. **What I see** – symbol, timeframe, last price (only if readable).
2. **Trend** – higher timeframe bias (up / down / range) and why in one line (highs/lows, MAs if shown).
3. **Key levels** – up to 3 resistance and 3 support levels, read from the chart. Mark which were touched today.
4. **Setup** – name it if there is one (break and retest, liquidity sweep, range fade, trend pullback). If none: "No clean setup. Waiting is a position."
5. **Grade** –
   - **A**: with the trend, at a clear level, stop has a logical place, room to 2R.
   - **B**: two of the above.
   - **C**: one or none → tell the user to skip.
6. **If A or B** – suggested entry zone, invalidation (stop) level, and first target. Then say: "Run `/risk-manager` for size and `/exit-planner` for the full exit plan."

Finish with one line: what would make this setup **wrong**.
