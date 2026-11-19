---
name: pelosi-tracker
description: Look up recent publicly disclosed stock trades by members of the US Congress (STOCK Act filings), focused on gold, miners, and macro ETFs. Use when the user asks "what is Congress buying", "Pelosi trades" or about politician trades in gold.
---

# Congress Trade Tracker ("Pelosi Tracker")

Uses only **public STOCK Act disclosures**. Sources to search: House Clerk financial disclosures
(disclosures-clerk.house.gov), Senate eFD (efdsearch.senate.gov), and public trackers that cite them
(e.g. Capitol Trades, Quiver Quantitative, Unusual Whales).

1. Search for disclosures in the last 30–60 days.
2. Filter to: GLD, IAU, GDX, GDXJ, NEM, GOLD, AEM, WPM, FNV, and macro proxies (TLT, UUP, SPY) if relevant.
   If the user names a member or ticker, use that instead.
3. Output:

| Member | Ticker | Buy/Sell | Amount range | Trade date | Filed date | Source |
|---|---|---|---|---|---|---|

4. Add the honest caveats every time:
   - Filings can be up to 45 days late, so this is **old news** by the time you see it.
   - Amounts are ranges, not exact.
   - A spouse's or a fund's trade is not a signal by itself.

Never present this as a trading signal. It is context only. Do not guess trades that you cannot link to a filing.
