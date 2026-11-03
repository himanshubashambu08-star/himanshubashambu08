"""In-memory broker for tests and dry runs. No network, no money."""
import itertools

from ..models import Account, Instrument, Price, Trade
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

    def modify_stop(self, trade_id, price, instrument=None):
        self.trades[trade_id].stop = price

    def close_trade(self, trade_id, at=None):
        t = self.trades.pop(trade_id)
        exit_ = at if at is not None else self.mid[t.instrument]
        self.balance += (exit_ - t.entry) * t.units
        self.closed.append((t, exit_))

    def closed_price(self, trade_id):
        for t, exit_ in self.closed:
            if t.id == trade_id:
                return exit_
        return None

    def move(self, instrument, mid):
        """Move price; fill stops / targets that were crossed (stop checked first)."""
        self.mid[instrument] = mid
        for t in [t for t in self.trades.values() if t.instrument == instrument]:
            if t.stop is not None and (mid - t.stop) * t.side <= 0:
                self.close_trade(t.id, at=t.stop)
            elif t.take_profit is not None and (mid - t.take_profit) * t.side >= 0:
                self.close_trade(t.id, at=t.take_profit)
