"""Append-only CSV log of every decision, so you can see why the bot did what it did."""
import csv
import os
from datetime import datetime, timezone

FIELDS = ["time_utc", "event", "instrument", "side", "units", "entry", "stop", "tp", "reason", "note"]


class Journal:
    def __init__(self, path=None):
        self.path = path
        self.rows = []

    def write(self, event, instrument, side, **kw):
        row = {"time_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "event": event, "instrument": instrument,
               "side": "BUY" if side > 0 else "SELL", **kw}
        self.rows.append(row)
        if not self.path:
            return
        new = not os.path.exists(self.path)
        with open(self.path, "a", newline="") as f:
            w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
            if new:
                w.writeheader()
            w.writerow(row)
