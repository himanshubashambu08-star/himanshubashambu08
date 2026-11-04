"""In-memory broker for tests and dry runs. No network, no money."""
import itertools

from ..models import Account, Price, Trade
from .base import Broker


class SimBroker(Broker):
    def __init__(self, balance=10_000.0, spread=0.0, instruments=None):
        self.balance = balance
        self.spread = spread
        self._instruments = {i.name: i for i in (instruments or [])}
        self.data = {}        # (instrument, granularity) -> list[Candle]
        self.mid = {}         # instrument -> mid price
        self.trades = {}
        self.closed = []
        self.orders = []
        self._ids = itertools.count(1)
        self.tradeable = True

    def account(self):
        upl = sum((self.mid[t.instrument] - t.entry) * t.units for t in self.trades.values())
        return Account(balance=self.balance, nav=self.balance + upl)

    def instruments(self):
        return list(self._instruments.values())

    def candles(self, instrument, granularity, count):
        return self.data.get((instrument, granularity), [])[-count:]

    def price(self, instrument):
        m = self.mid[instrument]
        return Price(bid=m - self.spread / 2, ask=m + self.spread / 2, tradeable=self.tradeable)

    def quote_to_home(self, instrument):
        return 1.0

    def open_trades(self):
        return list(self.trades.values())

    def market_order(self, instrument, units, stop, take_profit):
        p = self.price(instrument)
        entry = p.ask if units > 0 else p.bid
        t = Trade(id=str(next(self._ids)), instrument=instrument, units=units,
                  entry=entry, stop=stop, take_profit=take_profit)
        self.trades[t.id] = t
        self.orders.append(t)
        return t

    def stop_order(self, instrument, units, price, stop, take_profit, expire_ts):
        oid = "o" + str(next(self._ids))
        self.pending = getattr(self, "pending", {})
        self.pending[oid] = {"instrument": instrument, "units": units, "price": price, "stop": stop,
                             "tp": take_profit, "expire": expire_ts, "state": "PENDING", "trade_id": None}
        return oid

    def cancel_order(self, order_id):
        o = getattr(self, "pending", {}).get(order_id)
        if o and o["state"] == "PENDING":
            o["state"] = "CANCELLED"

    def order_status(self, order_id):
        o = getattr(self, "pending", {}).get(order_id)
        return {"state": o["state"], "trade_id": o["trade_id"], "price": o["price"]} if o else {"state": "CANCELLED"}

    def candles_range(self, instrument, granularity, start_ts, end_ts=None):
        return [c for c in self.data.get((instrument, granularity), []) if c.time >= start_ts]

    def modify_stop(self, trade_id, price, instrument=None):
        self.trades[trade_id].stop = price

    def close_trade(self, trade_id, at=None):
        t = self.trades.pop(trade_id)
        exit_ = at if at is not None else self.mid[t.instrument]
        self.balance += (exit_ - t.entry) * t.units
        self.closed.append((t, exit_))

    def closed_trade(self, trade_id):
        for t, exit_ in self.closed:
            if t.id == trade_id:
                return {"price": exit_, "pl": (exit_ - t.entry) * t.units, "time": None,
                        "instrument": t.instrument, "units": t.units}
        return None

    def closed_price(self, trade_id):
        for t, exit_ in self.closed:
            if t.id == trade_id:
                return exit_
        return None

    def move(self, instrument, mid):
        """Move price; fill stops / targets that were crossed (stop checked first)."""
        self.mid[instrument] = mid
        for oid, o in getattr(self, "pending", {}).items():          # pending stop entries
            if o["state"] == "PENDING" and o["instrument"] == instrument and (mid - o["price"]) * o["units"] >= 0:
                t = Trade(id=str(next(self._ids)), instrument=instrument, units=o["units"], entry=o["price"],
                          stop=o["stop"], take_profit=o["tp"])
                self.trades[t.id] = t
                self.orders.append(t)
                o.update(state="FILLED", trade_id=t.id)
        for t in [t for t in self.trades.values() if t.instrument == instrument]:
            if t.stop is not None and (mid - t.stop) * t.side <= 0:
                self.close_trade(t.id, at=t.stop)
            elif t.take_profit is not None and (mid - t.take_profit) * t.side >= 0:
                self.close_trade(t.id, at=t.take_profit)
