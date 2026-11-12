---
name: price-alerts
description: Turn the user's gold levels into a clean alert list for TradingView or the broker app, with what to do when each fires. Use when the user asks to "set alerts", "watch these levels" or after a chart scan.
---

# Price Alerts

Inputs: levels (from the user or `/chart-scanner`), instrument, and current price if known.

For each level output one row:

| # | Price | Condition | Message to paste | When it fires, do this |
|---|---|---|---|---|
| 1 | 2,425.0 | crosses up | "MGC 2425 PDH break – check retest" | Wait for 5-min close above, then `/entry-timer` |
| 2 | 2,404.0 | crosses down | "MGC 2404 Asia low – sweep?" | Watch for reclaim, no chasing |

Rules:
- Max 6 alerts; more is noise. Keep the ones nearest to price and the daily high/low.
- Alerts are a reason to **look**, not to enter.
- Add one alert at the daily-loss line if the user shares open P&L tracking.

Also give a one-line TradingView how-to: right-click price → Add alert → Condition "Crossing" → paste message.
If the user wants alerts on their phone automatically, suggest TradingView mobile push or a webhook to a
tool they already use; do not set up anything without them asking.
