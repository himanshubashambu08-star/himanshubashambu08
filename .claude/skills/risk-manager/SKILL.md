---
name: risk-manager
description: Calculate position size for gold futures (MGC/GC) from dollar risk and stop distance, and check it against prop-firm limits. Use when the user asks "how many contracts?", "size?" or gives an entry and stop.
---

# Risk Manager

Inputs: entry, stop, instrument (MGC default), and either $ risk per trade or % of account.
Also ask once for: daily loss limit left today, max drawdown room left.

Formula:
- Points at risk = |entry − stop|
- $ per contract = points × ($10 for MGC, $100 for GC)
- Contracts = floor(risk $ ÷ $ per contract). Never round up.

Hard rules (say NO if broken):
- Risk per trade ≤ 25% of the daily loss limit left.
- Risk per trade ≤ 1% of drawdown room, unless the user has set their own rule; then use theirs.
- If contracts = 0 → "Stop is too wide for your risk. Tighter stop or skip."
- Stop under $1.00 on gold is usually noise; warn.

Output:

```
Stop distance: $3.20  → $32 per MGC
Risk budget:   $150   → 4 MGC  (risk $128)
Daily limit left after a loss: $372
OK ✅
```

Do the arithmetic step by step and double-check it; a wrong size is worse than no answer.
