---
name: budget-manager
description: Track prop-firm account health - daily loss limit, max drawdown (trailing or static), profit target and consistency rule - and say how much can still be risked today. Use when the user asks about account status, "how much can I lose today" or "how far to target".
---

# Budget Manager

Ask once (then reuse in the conversation): account size, firm rules (daily loss limit, max drawdown and
whether it trails, profit target, consistency % if any), current balance, highest balance, today's P&L.

Calculate and show:

| Item | Value |
|---|---|
| Daily loss left today | limit − today's loss |
| Drawdown floor | static: start − max DD; trailing: high-water − max DD (capped at start if the firm locks it) |
| Room to floor | balance − floor |
| To profit target | target − profit so far |
| Consistency | best day ÷ total profit vs firm's % (flag if over) |
| **Max risk next trade** | min(25% of daily left, 1% of room to floor) |

Then one status line:
- 🟢 Healthy – trade normally.
- 🟡 Careful – under 50% of daily left or under 30% of drawdown room: half size.
- 🔴 Stop – daily left under one full-size loss: done for the day (new day starts 17:00 ET).

Trading day resets at 17:00 ET, same as Trade Gate. Never suggest "making it back".
