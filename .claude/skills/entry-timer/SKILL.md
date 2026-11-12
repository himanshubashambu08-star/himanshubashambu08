---
name: entry-timer
description: Decide if right now is a good moment to enter a gold trade, using session time, news windows and the user's pre-trade checklist. Use when the user says "should I enter?", "can I take this?" or "entry now?".
---

# Entry Timer

Answer with **GO**, **WAIT (until hh:mm ET)** or **NO** and the reasons. Be strict; the job is to protect the user.

Check, in order:

1. **Clock** – current ET time (`TZ=America/New_York date`).
   - Best gold windows: London open 03:00–05:00 ET, New York 08:20–11:30 ET.
   - Weak: 12:00–13:30 ET lunch chop. 16:00–18:00 ET: market closing / closed (day resets at 17:00).
2. **News** – any HIGH impact event within ±10 minutes? Then WAIT. Run `/news-monitor` logic if unsure.
3. **Account state** – ask (if not already given): P&L today, trades taken today, losses in a row.
   - At or past 2 losses in a row → NO, take a 30-minute break.
   - Within 20% of daily loss limit → NO.
4. **Setup grade** – only A or B (see `/chart-scanner`). C → NO.
5. **Checklist** – stop decided? size calculated? screenshot taken? If any is "no" → WAIT until done.

Output format:

```
VERDICT: WAIT until 08:41 ET
- CPI at 08:30 (HIGH)
- Setup grade B, stop and size ready
```
