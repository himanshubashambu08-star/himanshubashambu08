---
name: news-monitor
description: Check today's gold-moving news and US economic calendar, and list no-trade windows in ET. Use before the session or when the user asks "any news today?".
---

# News Monitor

Goal: tell the user what can move gold today and when NOT to be in a trade.

1. Get today's date in **America/New_York** (`TZ=America/New_York date`).
2. Search the web for today's US economic calendar (high-impact only) and the latest gold headlines
   (Fed speakers, CPI/PPI, NFP, jobless claims, FOMC, geopolitics, dollar/DXY, real yields, central bank buying).
   Use at least two sources; prefer official ones (bls.gov, federalreserve.gov) for times.
3. Output:

```
TODAY (ET)        EVENT                     IMPACT   NO-TRADE WINDOW
08:30             CPI m/m                   HIGH     08:25 – 08:40
14:00             FOMC statement            HIGH     13:55 – 14:30
```

4. **Mood line** – one sentence on the gold backdrop (dollar, yields, risk-on/off) with the source.
5. **Rule reminder** – "Flat 5 minutes before any HIGH event. No new trade until 10 minutes after."
   This matches the news block in Trade Gate.

If you cannot verify a time, write "time unconfirmed" instead of guessing. Always show source links.
