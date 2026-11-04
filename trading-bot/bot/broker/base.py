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
