"""OANDA v20 REST adapter (stdlib only).

practice = OANDA demo account (fake money, real prices). live = real money.
Docs: https://developer.oanda.com/rest-live-v20/introduction/
"""
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from ..models import Account, Candle, Instrument, Price, Trade
from .base import Broker

HOSTS = {
    "practice": "https://api-fxpractice.oanda.com",
    "live": "https://api-fxtrade.oanda.com",
}


class OandaError(RuntimeError):
    pass


def _ts(rfc3339: str) -> float:
    return datetime.strptime(rfc3339[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp()


class OandaBroker(Broker):
    def __init__(self, token, account_id, env="practice", timeout=15):
        if env not in HOSTS:
            raise ValueError("env must be 'practice' or 'live'")
        self.host, self.token, self.account_id, self.timeout = HOSTS[env], token, account_id, timeout
        self._instruments = None
        self._home = None

    # ---- http --------------------------------------------------------
    def _req(self, method, path, params=None, body=None, retries=3):
        url = self.host + path + ("?" + urllib.parse.urlencode(params) if params else "")
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json",
                   "Accept-Datetime-Format": "RFC3339"}
        for attempt in range(retries):
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    return json.loads(r.read() or b"{}")
            except urllib.error.HTTPError as e:
                msg = e.read().decode(errors="replace")
                # retry only rate limits / server errors, and never re-send an order POST
                if e.code in (429, 500, 502, 503, 504) and method == "GET" and attempt < retries - 1:
                    time.sleep(2 ** attempt)
                    continue
                raise OandaError(f"{method} {path} -> HTTP {e.code}: {msg}") from None
            except urllib.error.URLError as e:
                if method == "GET" and attempt < retries - 1:
                    time.sleep(2 ** attempt)
                    continue
                raise OandaError(f"{method} {path} -> {e.reason}") from None

    def _acct(self, suffix=""):
        return f"/v3/accounts/{self.account_id}{suffix}"

    # ---- reads -------------------------------------------------------
    def account(self):
        a = self._req("GET", self._acct("/summary"))["account"]
        self._home = a["currency"]
        return Account(balance=float(a["balance"]), nav=float(a["NAV"]), currency=a["currency"])

    def instruments(self):
        if self._instruments is None:
            out = self._req("GET", self._acct("/instruments"))["instruments"]
            self._instruments = {
                i["name"]: Instrument(
                    name=i["name"], type=i["type"],
                    display_precision=int(i["displayPrecision"]),
                    units_precision=int(i["tradeUnitsPrecision"]),
                    min_units=float(i["minimumTradeSize"]),
                ) for i in out
            }
        return list(self._instruments.values())

    def instrument(self, name):
        self.instruments()
        return self._instruments[name]

    def candles(self, instrument, granularity, count):
        out = self._req("GET", f"/v3/instruments/{instrument}/candles",
                        {"granularity": granularity, "count": count, "price": "M"})
        return [Candle(time=_ts(c["time"]), o=float(c["mid"]["o"]), h=float(c["mid"]["h"]),
                       l=float(c["mid"]["l"]), c=float(c["mid"]["c"]),
                       volume=int(c.get("volume", 0)), complete=bool(c["complete"]))
                for c in out["candles"]]

    def price(self, instrument):
        p = self._req("GET", self._acct("/pricing"), {"instruments": instrument})["prices"][0]
        return Price(bid=float(p["bids"][0]["price"]), ask=float(p["asks"][0]["price"]),
                     tradeable=bool(p.get("tradeable", True)))

    def prices(self, instruments):
        if not instruments:
            return {}
        out = self._req("GET", self._acct("/pricing"), {"instruments": ",".join(instruments)})["prices"]
        return {p["instrument"]: Price(bid=float(p["bids"][0]["price"]), ask=float(p["asks"][0]["price"]),
                                       tradeable=bool(p.get("tradeable", True))) for p in out}

    def quote_to_home(self, instrument):
        """How many home-currency units 1 unit of the instrument's quote currency is worth."""
        if self._home is None:
            self.account()
        quote = instrument.split("_")[-1]
        if quote == self._home:
            return 1.0
        names = {i.name for i in self.instruments()}
        if f"{quote}_{self._home}" in names:
            return self.price(f"{quote}_{self._home}").mid
        if f"{self._home}_{quote}" in names:
            return 1.0 / self.price(f"{self._home}_{quote}").mid
        return 0.0  # unknown -> sizing returns 0 -> no trade

    def open_trades(self):
        out = self._req("GET", self._acct("/openTrades"))["trades"]
        return [Trade(
            id=t["id"], instrument=t["instrument"], units=float(t["currentUnits"]),
            entry=float(t["price"]),
            stop=float(t["stopLossOrder"]["price"]) if t.get("stopLossOrder") else None,
            take_profit=float(t["takeProfitOrder"]["price"]) if t.get("takeProfitOrder") else None,
            unrealized_pl=float(t.get("unrealizedPL", 0)),
        ) for t in out]

    def closed_price(self, trade_id):
        t = self._req("GET", self._acct(f"/trades/{trade_id}"))["trade"]
        if t.get("state") != "CLOSED" or "averageClosePrice" not in t:
            return None
        return float(t["averageClosePrice"])

    # ---- writes ------------------------------------------------------
    def _fmt(self, instrument, price):
        return f"{price:.{self.instrument(instrument).display_precision}f}"

    def market_order(self, instrument, units, stop, take_profit):
        inst = self.instrument(instrument)
        body = {"order": {
            "type": "MARKET", "instrument": instrument,
            "units": f"{units:.{max(inst.units_precision, 0)}f}",
            "timeInForce": "FOK", "positionFill": "DEFAULT",
            "stopLossOnFill": {"price": self._fmt(instrument, stop), "timeInForce": "GTC"},
            "takeProfitOnFill": {"price": self._fmt(instrument, take_profit), "timeInForce": "GTC"},
        }}
        r = self._req("POST", self._acct("/orders"), body=body)
        fill = r.get("orderFillTransaction")
        if not fill or not fill.get("tradeOpened"):
            reason = (r.get("orderCancelTransaction") or {}).get("reason", "not filled")
            raise OandaError(f"order for {instrument} not filled: {reason}")
        t = fill["tradeOpened"]
        return Trade(id=t["tradeID"], instrument=instrument, units=float(t["units"]),
                     entry=float(t["price"]), stop=stop, take_profit=take_profit)

    def modify_stop(self, trade_id, price, instrument=None):
        p = self._fmt(instrument, price) if instrument else f"{price}"
        self._req("PUT", self._acct(f"/trades/{trade_id}/orders"),
                  body={"stopLoss": {"price": p, "timeInForce": "GTC"}})

    def close_trade(self, trade_id):
        self._req("PUT", self._acct(f"/trades/{trade_id}/close"), body={"units": "ALL"})
