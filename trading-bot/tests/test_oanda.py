"""Checks the OANDA adapter builds correct requests and parses responses (no network)."""
import unittest

from bot.broker.oanda import OandaBroker, OandaError


class FakeOanda(OandaBroker):
    def __init__(self, responses):
        super().__init__("tok", "001-001-1-001", "practice")
        self.responses, self.calls = responses, []

    def _req(self, method, path, params=None, body=None, retries=3):
        self.calls.append((method, path, params, body))
        for key, resp in self.responses.items():
            if key in path:
                return resp
        raise AssertionError("unexpected " + path)


INSTR = {"instruments": [
    {"name": "XAU_USD", "type": "METAL", "displayPrecision": 3, "tradeUnitsPrecision": 0, "minimumTradeSize": "1"},
    {"name": "USD_JPY", "type": "CURRENCY", "displayPrecision": 3, "tradeUnitsPrecision": 0, "minimumTradeSize": "1"},
]}


class OandaAdapter(unittest.TestCase):
    def test_candles_parse(self):
        b = FakeOanda({"/candles": {"candles": [
            {"time": "2026-11-03T14:00:00.000000000Z", "complete": True, "volume": 10,
             "mid": {"o": "2400.1", "h": "2405", "l": "2399", "c": "2403.5"}}]}})
        c = b.candles("XAU_USD", "H1", 1)[0]
        self.assertEqual((c.o, c.c, c.complete), (2400.1, 2403.5, True))
        self.assertEqual(c.time, 1793714400.0)

    def test_order_body_has_sl_tp_and_precision(self):
        b = FakeOanda({"/instruments": INSTR, "/orders": {"orderFillTransaction": {
            "tradeOpened": {"tradeID": "42", "units": "-7", "price": "2401.250"}}}})
        t = b.market_order("XAU_USD", -7, 2405.12345, 2393.0)
        method, path, _, body = b.calls[-1]
        o = body["order"]
        self.assertEqual((method, o["type"], o["units"]), ("POST", "MARKET", "-7"))
        self.assertEqual(o["stopLossOnFill"]["price"], "2405.123")
        self.assertEqual(o["takeProfitOnFill"]["price"], "2393.000")
        self.assertEqual((t.id, t.units, t.entry), ("42", -7.0, 2401.25))

    def test_rejected_order_raises(self):
        b = FakeOanda({"/instruments": INSTR, "/orders": {
            "orderCancelTransaction": {"reason": "MARKET_HALTED"}}})
        with self.assertRaises(OandaError):
            b.market_order("XAU_USD", 1, 2390, 2420)

    def test_quote_to_home_for_jpy_pair(self):
        b = FakeOanda({"/summary": {"account": {"currency": "USD", "balance": "1000", "NAV": "1000"}},
                       "/instruments": INSTR,
                       "/pricing": {"prices": [{"bids": [{"price": "150.0"}], "asks": [{"price": "150.0"}]}]}})
        self.assertAlmostEqual(b.quote_to_home("USD_JPY"), 1 / 150.0)
        self.assertEqual(b.quote_to_home("XAU_USD"), 1.0)


if __name__ == "__main__":
    unittest.main()


class OandaPrices(unittest.TestCase):
    def test_prices_one_call(self):
        b = FakeOanda({"/pricing": {"prices": [
            {"instrument": "EUR_USD", "bids": [{"price": "1.1"}], "asks": [{"price": "1.1002"}], "tradeable": True},
            {"instrument": "USD_JPY", "bids": [{"price": "150"}], "asks": [{"price": "150.02"}], "tradeable": False}]}})
        out = b.prices(["EUR_USD", "USD_JPY"])
        self.assertEqual(len(b.calls), 1)
        self.assertEqual(b.calls[0][2], {"instruments": "EUR_USD,USD_JPY"})
        self.assertAlmostEqual(out["EUR_USD"].mid, 1.1001)
        self.assertFalse(out["USD_JPY"].tradeable)


class OandaSpread(unittest.TestCase):
    def test_typical_spread_is_median_of_bid_ask_candles(self):
        cs = [{"bid": {"c": "100"}, "ask": {"c": f"{100 + x}"}} for x in (0.2, 0.3, 5.0)]
        b = FakeOanda({"/candles": {"candles": cs}})
        self.assertAlmostEqual(b.typical_spread("XAU_USD"), 0.3)
        self.assertEqual(b.calls[0][2]["price"], "BA")
