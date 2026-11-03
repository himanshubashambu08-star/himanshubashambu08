---
name: order-executor
description: Turn a planned gold trade into a clear bracket order ticket (entry, stop, targets, size) for the user to place in their own platform. Never places orders. Use when the user says "make the order", "order ticket" or "place it".
---

# Order Executor (ticket only)

This skill **does not place orders** and must not call any broker API. It writes a ticket the user
copies into their platform (Tradovate, NinjaTrader, Rithmic, TradingView, etc.).

Before writing the ticket, confirm all of these exist; if any is missing, stop and ask:
- Direction, instrument + contract month (e.g. MGCZ6), size from `/risk-manager`
- Entry type (limit / stop / market) and price
- Stop and targets from `/exit-planner`
- `/entry-timer` verdict is GO

Ticket format:

```
BUY 4 MGCZ6  LIMIT 2,411.2   (bracket / OCO)
  STOP LOSS   2,408.0   (-$128)
  TAKE PROFIT 2 @ 2,414.4 (+$64)   2 @ 2,417.6 (+$128)
  Time in force: DAY
After TP1 fills → move stop to 2,411.3
```

End with: "Double-check symbol, side and size in your platform before clicking. Take the entry screenshot for Trade Gate."
