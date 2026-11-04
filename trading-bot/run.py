#!/usr/bin/env python3
"""Start the bot.

  python run.py backtest --instruments XAU_USD,EUR_USD     # test the rules on history first
  python run.py practice                                     # 24/5 on an OANDA DEMO account
  python run.py live --i-understand-real-money               # real money (only after demo results)
  python run.py flatten                                      # close every open trade now
  python run.py review                                       # run the daily self-review now

The dashboard runs with the bot at http://127.0.0.1:8050 (change with --port / --host).

Env vars: OANDA_TOKEN, OANDA_ACCOUNT_ID (demo and live have different ones).
"""
import argparse
import json
import logging
import os
import sys

from bot import dashboard
from bot.backtest import run as backtest_run, summary
from bot.broker.oanda import OandaBroker
from bot.engine import DEFAULTS as ENGINE_DEFAULTS, Engine
from bot.risk import DEFAULTS as RISK_DEFAULTS


def load_config(path):
    if path and os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {}


def make_broker(env):
    token, acct = os.environ.get("OANDA_TOKEN"), os.environ.get("OANDA_ACCOUNT_ID")
    if not token or not acct:
        sys.exit("Set OANDA_TOKEN and OANDA_ACCOUNT_ID first (see README).")
    return OandaBroker(token, acct, env=env)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["backtest", "practice", "live", "flatten", "review"])
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--instruments", help="comma list, overrides config (backtest)")
    ap.add_argument("--bars", type=int, default=5000, help="history bars for backtest (max 5000)")
    ap.add_argument("--env", default="practice", choices=["practice", "live"],
                    help="which account flatten/backtest uses")
    ap.add_argument("--i-understand-real-money", action="store_true")
    ap.add_argument("--host", default="127.0.0.1", help="dashboard host (keep 127.0.0.1 on a server)")
    ap.add_argument("--port", type=int, default=8050, help="dashboard port, 0 = no dashboard")
    a = ap.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.StreamHandler(), logging.FileHandler("bot.log")])
    cfg = load_config(a.config)
    eng_cfg = {**ENGINE_DEFAULTS, **cfg.get("engine", {})}

    if a.mode == "live" and not a.i_understand_real_money:
        sys.exit("Live trading uses real money. Run on 'practice' for weeks first. "
                 "If you are sure, add --i-understand-real-money.")

    if a.mode == "backtest" and eng_cfg.get("strategy") == "ema_break":
        broker = make_broker(a.env)
        eng = Engine(broker, cfg, news_fetcher=lambda: [])
        r = eng.ema_backtest("cli")
        if not r:
            sys.exit("No history downloaded.")
        for k, label in (("tuning", "Tuning (purana 70%)"), ("unseen", "Unseen (naya 30%)"), ("all", "Sab")):
            c = r[k]
            print(f"{label:22} trades {c['n']:4}  win {c['win_pct']:5}%  PF {c['pf']}  total {c['total_r']:+.1f}R  "
                  f"max DD {c['max_dd_r']}R")
        print("GATE:", "PASS - demo trading allowed" if r["passed"] else "FAIL - " + r["reason"])
        return

    if a.mode == "backtest":
        broker = make_broker(a.env)
        names = a.instruments.split(",") if a.instruments else eng_cfg["instruments"]
        if names == "ALL":
            names = [i.name for i in broker.instruments() if i.type in eng_cfg["instrument_types"]]
        risk = {**RISK_DEFAULTS, **cfg.get("risk", {})}
        all_trades = []
        for n in names:
            ltf = broker.candles(n, eng_cfg["entry_timeframe"], a.bars)
            htf = broker.candles(n, eng_cfg["trend_timeframe"], a.bars)
            t = backtest_run(n, htf, ltf, eng_cfg["entry_timeframe"], eng_cfg["trend_timeframe"],
                             cfg.get("strategy"), risk["reward_risk"], eng_cfg["breakeven_at_r"])
            print(n, summary(t))
            all_trades += t
        all_trades.sort(key=lambda t: t["time"])
        print("ALL", summary(all_trades))
        return

    env = "live" if a.mode == "live" else a.env
    broker = make_broker(env)
    if a.mode == "flatten":
        for t in broker.open_trades():
            broker.close_trade(t.id)
            print("closed", t.instrument, t.id)
        return

    engine = Engine(broker, cfg, state_path=f"state-{env}.json", journal_path=f"journal-{env}.csv", agents_path=f"agents-{env}.json",
                    news_path="news-cache.json", brain_path=f"brain-{env}.json", seen_path=f"seen-{env}.json",
                    memory_path=f"memory-{env}.db")
    if a.mode == "review":
        from bot.risk import trading_day
        import time
        engine.review(trading_day(time.time() - 86400))
        print("report written to", engine.learner.p["reports_dir"])
        return
    if a.port:
        dashboard.start(engine, a.host, a.port)
        logging.info("dashboard: http://%s:%d", a.host, a.port)
    engine.run_forever()


if __name__ == "__main__":
    main()
