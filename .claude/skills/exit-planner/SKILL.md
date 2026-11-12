---
name: exit-planner
description: Build a full exit plan for a gold trade before entry - stop, targets, partials, breakeven and time stop - with dollar values for MGC/GC. Use when the user has an entry idea and asks for targets or an exit plan.
---

# Exit Planner

Inputs (ask only for what is missing): direction, entry price, stop price, contracts, instrument (MGC default).

Math:
- MGC: $10 per $1 move per contract. GC: $100 per $1 move per contract.
- Risk ($) = |entry − stop| × $/point × contracts. 1R = that risk.

Plan to output:

| Step | Price | What to do | $ result |
|---|---|---|---|
| Stop | … | Full exit, no moving it further | −1R |
| TP1 at 1R | … | Close half (if >1 contract) | +… |
| Breakeven | – | After TP1, stop to entry + 1 tick | 0 |
| TP2 at 2R (or next level) | … | Close rest | +… |

Also add:
- **Time stop**: if price has not moved 0.5R in your favour in 20 minutes, close it.
- **News stop**: be flat 5 minutes before a HIGH event.
- **Day-end stop**: be flat by 16:50 ET (day resets at 17:00 ET).

If TP2 sits beyond a strong level from `/chart-scanner`, move TP2 just before that level and say so.
If reward-to-risk is below 1.5, say "Not worth it" plainly.
