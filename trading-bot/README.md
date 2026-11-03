# 24/5 Trading Bot

A bot that runs non-stop while forex and metals markets are open (Sunday evening to Friday 5 PM New York).
Every hour it:

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
| `engine.instruments` | 7 majors + gold/silver | list, or `"ALL"` for every currency/metal on the account |
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
