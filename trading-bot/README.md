# 24/5 Forex Trading Bot (self-learning)

A bot that runs non-stop while the forex market is open (Sunday evening to Friday 5 PM New York).
It **watches every chart all the time**, but only **opens trades during the New York (US) session**
(08:00-16:00 New York by default, `engine.entry_sessions_ny`).

## Live chart board

Open **http://127.0.0.1:8050** while the bot runs. Every chart is shown side by side, refreshed every minute,
sorted by how close it is to a trade:

| Badge | Meaning |
|---|---|
| **SIGNAL** | All rules met on the last closed candle. The card says whether the bot took it or why it skipped. |
| **FORMING** | Trend is there and price is coming into the pullback zone (shaded band). A setup may appear soon. |
| **WATCH** | Trend is there but price is stretched, or the trend may be breaking. |
| **NO SETUP** | No clear higher-timeframe trend. Sit out. |

The side panel shows open trades, what the bot learned, the rules it taught itself, its top mistakes and its latest decisions.
On a server, keep it private and use an SSH tunnel: `ssh -L 8050:127.0.0.1:8050 you@server`.

## How it learns from its mistakes, every day

1. **Remembers every setup** (`memory-<env>.db`): the trades it took **and** the ones it skipped
   (outside the US session, blocked by a rule, risk limits), with the conditions at that moment
   (hour, RSI, trend strength, spread, how stretched price was, candle size).
2. **Follows each one on the chart** until it would have hit the stop or the target, so it learns from
   every chart, not just its own few trades.
3. **Labels the mistakes** in losing trades: stopped out within 2 candles, gave back a +1R profit,
   chased a big candle, entered far from the EMA, weak trend, wide spread, late in the session...
4. **Every day at 17:00 New York it reviews itself:**
   - a condition that keeps losing (at least 20 setups, statistically below zero, clearly worse than
     normal) becomes a new **"avoid" rule**. The rule is dropped again if those setups turn profitable.
   - it tries small changes to **one** setting (stop size, EMA, RSI band, target) and keeps a change
     only if it is better on older data **and** not worse on the most recent unseen data
     (walk-forward test, so it does not just memorise the past).
   - writes a plain report to `reports/YYYY-MM-DD.md`.
5. It **never** raises its own risk: risk per trade, daily loss limit and max drawdown are only yours to change.

Run the review by hand any time with `python run.py review`.

> Learning only works with data. Expect the first rules after a few weeks of demo running (it needs
> 20+ similar setups before it trusts a pattern). Learning can also be wrong when markets change, which
> is why every change is written down and reversible: delete `memory-<env>.db` to start fresh.

## What happens every hour

1. **Scans** every instrument you list (or `"ALL"` currencies and metals on your broker) on two timeframes.
2. **Checks the rules** (`bot/strategy.py`): higher-timeframe trend + pullback to EMA20 + RSI filter.
3. **Checks risk** (`bot/risk.py`): daily loss limit, max drawdown, open-trade limits, currency exposure, spread.
4. **Sizes** the trade so a stop-out loses only `risk_per_trade_pct` of the balance.
5. **Places a bracket order** with the stop-loss and take-profit attached at the broker,
   so they still work if the bot or the server goes down.
6. **Manages open trades** every 20 s: stop to breakeven at +1R, ATR trailing stop from +1.5R.
7. **Writes every decision** to `journal-<env>.csv` and `bot.log`.

Broker: **OANDA** (REST v20). Only the Python standard library is used, so there is nothing to `pip install`.

> **Warning.** No bot is guaranteed to make money. These rules are a starting template, not a proven
> edge. Run `backtest`, then run `practice` (demo money) for several weeks before thinking about `live`.

## 1. Setup

1. Open a free **OANDA demo (practice) account**, then go to *Manage API Access* and generate a token.
2. Note your account ID (looks like `101-001-1234567-001`).
3. ```bash
   cd trading-bot
   cp config.example.json config.json      # edit instruments, rules and risk here
   export OANDA_TOKEN=...  OANDA_ACCOUNT_ID=...
   ```

## 2. Test the rules on history

```bash
python run.py backtest                       # instruments from config.json
python run.py backtest --instruments XAU_USD,EUR_USD --bars 5000
```

The output is in **R** (1R = what you risk on one trade): number of trades, win rate, total R,
profit factor and max drawdown. If total R is negative or the drawdown scares you, change the rules
before going further.

## 3. Run 24/5 on demo

```bash
python run.py practice
```

To keep it running when your laptop is off, put it on a small Linux VPS (any $5/month server):

```bash
sudo mkdir -p /opt/trading-bot && sudo cp -r . /opt/trading-bot
printf 'OANDA_TOKEN=...\nOANDA_ACCOUNT_ID=...\n' | sudo tee /opt/trading-bot/.env
sudo chmod 600 /opt/trading-bot/.env
sudo cp trading-bot.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now trading-bot
journalctl -u trading-bot -f                 # watch it
```

Or with Docker: `docker build -t tbot . && docker run -d --restart=always --env-file .env tbot`.

## 4. Controls

| Want to... | Do this |
|---|---|
| Stop new trades, keep managing open ones | `touch STOP` in the bot folder (delete it to resume) |
| Close everything now | `python run.py flatten --env practice` (or `--env live`) |
| Skip news events | add `["2026-11-06T13:25","2026-11-06T13:45"]` (UTC) to `engine.blackout_utc` |
| Reset after max-drawdown halt | stop the bot, set `"halted_dd": false` in `state-<env>.json`, start again |

## 5. Going live (real money)

Only after weeks of demo results you are happy with:

```bash
export OANDA_TOKEN=<live token> OANDA_ACCOUNT_ID=<live account>
python run.py live --i-understand-real-money
```

Start with `risk_per_trade_pct` at 0.25 or lower.

## Rules and risk settings (`config.json`)

| Key | Default | Meaning |
|---|---|---|
| `engine.instruments` | 12 major/cross forex pairs | list, or `"ALL"` for every forex pair on the account |
| `engine.entry_sessions_ny` | `[["08:00","16:00"]]` | New York hours when new trades are allowed; `[]` = any time |
| `engine.learn` | true | turn self-learning on/off |
| `learning.min_samples` | 20 | setups needed before it learns a rule |
| `engine.entry_timeframe` / `trend_timeframe` | H1 / H4 | timeframes for entry and trend |
| `strategy.atr_stop_mult` | 1.5 | stop = 1.5 x ATR(14) |
| `risk.reward_risk` | 2.0 | take-profit at 2R |
| `risk.risk_per_trade_pct` | 0.5 | % of balance lost if the stop is hit |
| `risk.daily_loss_limit_pct` | 2.0 | no new trades for the rest of the day (resets 17:00 New York) |
| `risk.max_drawdown_pct` | 10 | bot halts until you reset it |
| `risk.max_open_trades` | 5 | |
| `risk.max_trades_per_currency` | 2 | e.g. at most 2 trades involving USD |

To use your own entry rules, edit `evaluate()` in `bot/strategy.py`. It must return a `Signal`
(side, stop distance, ATR) or `None`. Everything else (risk, sizing, orders, trailing) stays the same.

## Tests

```bash
python -m unittest discover -s tests -t .
```
