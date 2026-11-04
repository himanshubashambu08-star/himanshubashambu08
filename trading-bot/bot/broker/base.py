"""Interface every broker adapter implements. The engine only talks to this."""
from abc import ABC, abstractmethod


class Broker(ABC):
    @abstractmethod
    def account(self): ...                                   # -> Account
    @abstractmethod
    def instruments(self): ...                               # -> list[Instrument]
    @abstractmethod
    def candles(self, instrument, granularity, count): ...   # -> list[Candle]
    @abstractmethod
    def price(self, instrument): ...                         # -> Price
    @abstractmethod
    def quote_to_home(self, instrument): ...                 # -> float
    @abstractmethod
    def open_trades(self): ...                               # -> list[Trade]
    @abstractmethod
    def market_order(self, instrument, units, stop, take_profit): ...  # -> Trade
    @abstractmethod
    def modify_stop(self, trade_id, price, instrument=None): ...
    @abstractmethod
    def close_trade(self, trade_id): ...

    def stop_order(self, instrument, units, price, stop, take_profit, expire_ts):
        """Pending entry that fills only if price reaches `price` before `expire_ts`. Returns order id."""
        raise NotImplementedError

    def cancel_order(self, order_id):
        raise NotImplementedError

    def order_status(self, order_id):
        """{"state": "PENDING"|"FILLED"|"CANCELLED", "trade_id": str|None, "price": float|None}"""
        raise NotImplementedError

    def candles_range(self, instrument, granularity, start_ts, end_ts=None):
        """Candles from start_ts to now (or end_ts), any length (downloaded in pieces)."""
        return self.candles(instrument, granularity, 5000)

    def prices(self, instruments):
        """Latest prices for many instruments: {name: Price}. Adapters may do this in one call."""
        return {n: self.price(n) for n in instruments}

    def closed_price(self, trade_id):
        """Average close price of a finished trade, or None if unknown / still open."""
        return None

    def closed_trade(self, trade_id):
        """{"price", "pl" (account currency or None), "time", "instrument", "units"} of a finished trade, or None."""
        px = self.closed_price(trade_id)
        return None if px is None else {"price": px, "pl": None, "time": None, "instrument": None, "units": None}
