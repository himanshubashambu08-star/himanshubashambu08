"""Agent activity tracker.

The bot is split into 9 named agents. Each one records:
  - status  : what it is doing right now (one line)
  - plan    : what it will do next
  - events  : what it did ("did"), and what it passed to which agent ("handoff")
  - counts  : today's numbers (reset at 17:00 New York with the trading day)
Every signal also gets a "journey": the list of agents it passed through, each with a verdict.
"""
import json
import os
import threading
import time
from collections import deque

AGENTS = [
    ("scanner", "📡", "Chart Scanner", "Har minute saare charts ka taaza data laata hai aur Chart Reader ko deta hai."),
    ("reader", "👁️", "Chart Reader", "Har chart padhta hai: signal hai, setup ban raha hai, sirf trend hai, ya kuch nahi."),
    ("rules", "📏", "Rule Checker", "Entry ke rules check karta hai: bada trend (H4), EMA20 tak pullback, RSI, rejection candle."),
    ("timer", "⏰", "Entry Timer", "Dekhta hai abhi entry ka sahi time hai ya nahi: US session, news, STOP switch, seekhe hue rules."),
    ("risk", "🛡️", "Risk Manager", "Lot size nikalta hai aur limits check karta hai: daily loss, drawdown, exposure, spread."),
    ("executor", "🚀", "Order Executor", "Broker pe order lagata hai, SL aur TP ek saath."),
    ("manager", "🎯", "Exit Planner", "Open trades sambhalta hai: breakeven, trailing stop, aur close hone pe result nikalta hai."),
    ("learner", "🧠", "Time Machine", "Har setup ka result dekhta hai, galtiyan pakadta hai, roz naye rules aur settings seekhta hai."),
    ("budget", "💰", "Budget Manager", "Account ki health: aaj ka P&L, daily loss limit, drawdown, aur kitna risk bacha hai."),
]
NAMES = {a[0]: f"{a[1]} {a[2]}" for a in AGENTS}


class AgentLog:
    def __init__(self, path=None, clock=time.time, max_events=150, max_journeys=150):
        self.path, self.clock = path, clock
        self.lock = threading.Lock()
        self.max_events = max_events
        self.day = None
        self.agents = {a[0]: self._blank(a) for a in AGENTS}
        self.journeys = {}            # ref -> journey
        self.order = deque(maxlen=max_journeys)
        self.trade_refs = {}          # broker trade id -> journey ref
        self.dirty = False
        if path and os.path.exists(path):
            try:
                self._load()
            except Exception:
                pass

    def _blank(self, a):
        return {"id": a[0], "emoji": a[1], "name": a[2], "role": a[3], "status": "Shuru ho raha hai…",
                "tone": "idle", "plan": "", "counts": {}, "handoffs": {}, "events": deque(maxlen=self.max_events)}

    # ---- day ----------------------------------------------------------
    def set_day(self, day):
        if day and day != self.day:
            with self.lock:
                self.day = day
                for a in self.agents.values():
                    a["counts"], a["handoffs"] = {}, {}
                self.dirty = True

    # ---- per agent ------------------------------------------------------
    def status(self, agent, text, tone="ok"):
        a = self.agents[agent]
        if a["status"] != text or a["tone"] != tone:
            a["status"], a["tone"], self.dirty = text, tone, True

    def plan(self, agent, text):
        if self.agents[agent]["plan"] != text:
            self.agents[agent]["plan"], self.dirty = text, True

    def count(self, agent, key, n=1):
        c = self.agents[agent]["counts"]
        c[key] = c.get(key, 0) + n
        self.dirty = True

    def did(self, agent, text, ref=None, tone="info"):
        with self.lock:
            self.agents[agent]["events"].append(
                {"t": self.clock(), "kind": "did", "text": text, "ref": ref, "tone": tone})
            self.dirty = True

    def handoff(self, agent, to, text, ref=None, n=1):
        with self.lock:
            a = self.agents[agent]
            a["handoffs"][to] = a["handoffs"].get(to, 0) + n
            a["events"].append({"t": self.clock(), "kind": "handoff", "to": to, "text": text, "ref": ref,
                                "tone": "info"})
            self.dirty = True

    # ---- journeys -------------------------------------------------------
    def journey_start(self, ref, instrument, side, signal_time, reason):
        with self.lock:
            if ref not in self.journeys:
                self.order.append(ref)
            self.journeys[ref] = {"ref": ref, "instrument": instrument, "side": side, "time": signal_time,
                                  "created": self.clock(), "reason": reason, "steps": [],
                                  "state": "chal raha hai", "result": None, "r": None, "taken": False}
            # drop journeys that fell out of the window
            keep = set(self.order)
            for k in [k for k in self.journeys if k not in keep]:
                del self.journeys[k]
            self.dirty = True

    def step(self, ref, agent, verdict, text):
        j = self.journeys.get(ref)
        if not j:
            return
        with self.lock:
            j["steps"].append({"t": self.clock(), "agent": agent, "verdict": verdict, "text": text})
            if verdict == "block":
                j["state"] = "roka gaya"
            self.dirty = True

    def mark(self, ref, **kw):
        j = self.journeys.get(ref)
        if j:
            j.update(kw)
            self.dirty = True

    # ---- persistence / snapshot -----------------------------------------
    def snapshot(self):
        with self.lock:
            agents = []
            for aid, *_ in AGENTS:
                a = dict(self.agents[aid])
                a["events"] = list(a["events"])[::-1]
                agents.append(a)
            journeys = [self.journeys[r] for r in reversed(self.order) if r in self.journeys]
            return {"day": self.day, "agents": agents, "journeys": json.loads(json.dumps(journeys))}

    def save(self):
        if not self.path or not self.dirty:
            return
        data = self.snapshot()
        data["trade_refs"] = self.trade_refs
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f)
        os.replace(tmp, self.path)
        self.dirty = False

    def _load(self):
        with open(self.path) as f:
            data = json.load(f)
        self.day = data.get("day")
        self.trade_refs = data.get("trade_refs", {})
        for a in data.get("agents", []):
            if a["id"] in self.agents:
                cur = self.agents[a["id"]]
                cur.update(status=a.get("status", ""), tone=a.get("tone", "idle"), plan=a.get("plan", ""),
                           counts=a.get("counts", {}), handoffs=a.get("handoffs", {}))
                cur["events"].extend(reversed(a.get("events", [])))
        for j in reversed(data.get("journeys", [])):
            self.journeys[j["ref"]] = j
            self.order.append(j["ref"])
