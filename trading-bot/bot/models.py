"""Plain data objects shared by the broker, strategy, risk and engine code."""
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class Candle:
    time: float          # candle OPEN time, unix seconds (UTC)
    o: float
    h: float
    l: float
    c: float
    volume: int = 0
    complete: bool = True


@dataclass
class Instrument:
    name: str                 # e.g. "XAU_USD"
    type: str = "CURRENCY"    # CURRENCY | METAL | CFD
    display_precision: int = 5
    units_precision: int = 0
    min_units: float = 1.0

    @property
    def quote(self) -> str:
        return self.name.split("_")[-1]


@dataclass
class Price:
    bid: float
    ask: float
    tradeable: bool = True

    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2

    @property
    def spread(self) -> float:
        return self.ask - self.bid


@dataclass
class Trade:
    id: str
    instrument: str
    units: float              # +long / -short
    entry: float
    stop: float | None = None
    take_profit: float | None = None
    unrealized_pl: float = 0.0

    @property
    def side(self) -> int:
        return 1 if self.units > 0 else -1


@dataclass
class Account:
    balance: float
    nav: float
    currency: str = "USD"


@dataclass
class Signal:
    instrument: str
    side: int                 # +1 buy, -1 sell
    stop_distance: float      # in price units
    atr: float
    reason: str
    time: float = field(default_factory=lambda: datetime.now(timezone.utc).timestamp())


GRANULARITY_SECONDS = {
    "M1": 60, "M5": 300, "M15": 900, "M30": 1800,
    "H1": 3600, "H2": 7200, "H4": 14400, "D": 86400,
}
