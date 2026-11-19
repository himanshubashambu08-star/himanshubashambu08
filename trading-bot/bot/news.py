"""Economic calendar (free ForexFactory weekly feed) + per-currency news blackout.

Feed: list of {"title", "country" (currency code), "date" (ISO with offset), "impact"
("High"/"Medium"/"Low"/"Holiday"), "forecast", "previous", maybe "actual"}.
Fetched at most every `refresh_minutes` and cached to disk, so a restart or a feed outage
does not lose the week. If the feed cannot be read at all, trading is NOT blocked; the
News Monitor shows a warning instead.
"""
import json
import logging
import os
import time
import urllib.request
from datetime import datetime

log = logging.getLogger("bot")

DEFAULTS = {
    "enabled": True,
    "url": "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
    "refresh_minutes": 60,
    "block_impacts": ["High"],     # these events block new trades in that currency
    "show_impacts": ["High", "Medium"],
    "before_min": 15,
    "after_min": 15,
}


def parse(raw):
    out = []
    for e in raw or []:
        try:
            ts = datetime.fromisoformat(str(e["date"]).replace("Z", "+00:00")).timestamp()
        except (KeyError, ValueError):
            continue
        out.append({
            "time": ts, "currency": str(e.get("country", "")).upper(), "title": str(e.get("title", "")),
            "impact": str(e.get("impact", "")), "forecast": e.get("forecast") or "",
            "previous": e.get("previous") or "", "actual": e.get("actual") or "",
        })
    out.sort(key=lambda x: x["time"])
    return out


class NewsCalendar:
    def __init__(self, params=None, cache_path=None, clock=time.time, fetcher=None):
        self.p = {**DEFAULTS, **(params or {})}
        self.cache_path, self.clock = cache_path, clock
        self.fetcher = fetcher or self._fetch
        self.events, self.last_fetch, self.error = [], 0.0, None
        if cache_path and os.path.exists(cache_path):
            try:
                with open(cache_path) as f:
                    d = json.load(f)
                self.events, self.last_fetch = d.get("events", []), d.get("fetched", 0.0)
            except Exception:
                pass

    def _fetch(self):
        req = urllib.request.Request(self.p["url"], headers={"User-Agent": "trading-bot/1.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())

    def refresh(self, force=False):
        """Returns True when new data was loaded."""
        if not self.p["enabled"]:
            return False
        now = self.clock()
        if not force and now - self.last_fetch < self.p["refresh_minutes"] * 60:
            return False
        self.last_fetch = now                       # also on failure: do not hammer the feed
        try:
            events = parse(self.fetcher())
        except Exception as e:
            self.error = str(e)
            log.warning("news feed failed: %s", e)
            return False
        if not events:
            self.error = "feed khali aaya"
            return False
        keep = [e for e in self.events if e["time"] < events[0]["time"] and e["time"] > now - 3 * 86400]
        self.events, self.error = keep + events, None
        if self.cache_path:
            tmp = self.cache_path + ".tmp"
            with open(tmp, "w") as f:
                json.dump({"fetched": now, "events": self.events}, f)
            os.replace(tmp, self.cache_path)
        return True

    def window(self, e):
        return e["time"] - self.p["before_min"] * 60, e["time"] + self.p["after_min"] * 60

    def blocking(self, instrument, now=None):
        """The high-impact event blocking new trades in this instrument right now, or None."""
        if not self.p["enabled"]:
            return None
        now = self.clock() if now is None else now
        curs = set(instrument.split("_"))
        for e in self.events:
            if e["impact"] in self.p["block_impacts"] and e["currency"] in curs:
                a, b = self.window(e)
                if a <= now <= b:
                    return e
        return None

    def active(self, now=None):
        now = self.clock() if now is None else now
        return [e for e in self.events if e["impact"] in self.p["block_impacts"]
                and self.window(e)[0] <= now <= self.window(e)[1]]

    def upcoming(self, now=None, hours=24 * 7, currencies=None):
        now = self.clock() if now is None else now
        return [e for e in self.events if e["impact"] in self.p["show_impacts"]
                and now - 6 * 3600 <= e["time"] <= now + hours * 3600
                and (currencies is None or e["currency"] in currencies)]
