# Gold Trading Skills Pack (11 skills)

Claude Code skills that sit next to **Gold Trade Gate** (`petrol-receipts/trade-gate`).
Type the slash command in Claude Code from this repo, e.g. `/risk-manager`.

| Command | What it does |
|---|---|
| `/chart-scanner` | Reads a chart screenshot: trend, levels, setup, A/B/C grade |
| `/news-monitor` | Today's gold-moving news and red-folder events, with no-trade windows |
| `/entry-timer` | Says if *now* is a good time to enter (session, news, checklist) |
| `/exit-planner` | Stop, targets, partials and breakeven plan before you enter |
| `/time-machine` | Replays a past trade or day and finds the lesson |
| `/risk-manager` | Position size in MGC/GC from your $ risk and stop distance |
| `/budget-manager` | Prop account health: daily loss, drawdown, target, consistency |
| `/order-executor` | Builds a bracket order ticket for you to place (never places it) |
| `/price-alerts` | Turns your levels into an alert list for TradingView / broker |
| `/earnings-analyst` | Big macro prints for gold (CPI, NFP, FOMC) + miners' earnings |
| `/pelosi-tracker` | Congress members' disclosed trades in gold, miners and macro ETFs |

Defaults used by every skill (edit the SKILL.md files if yours differ):

- Instrument: **MGC** (micro gold, 10 oz, $0.10 tick = $1, $1 move = $10/contract). GC = 10x that.
- Trading day: 6 PM ET to 5 PM ET (same as Trade Gate's day reset).
- Account: prop firm. Daily loss limit, max drawdown and profit target come from you.
- Risk per trade: ask the user; never assume more than 1% of drawdown room.

None of these skills give financial advice or place trades. They are checklists and calculators
that make you slow down and follow your own plan.
