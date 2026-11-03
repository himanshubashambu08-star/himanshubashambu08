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
