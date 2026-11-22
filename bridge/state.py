"""Companion state manager for Claude Bot Bridge.
Ported from and compatible with ui/mood/mood.js, blending telemetry and overrides.
"""
import time
from typing import Dict, Any, Optional

def mood_of(p: float, masti: bool = False) -> str:
    if masti:
        return "masti"
    if p <= 15:
        return "idle"
    if p <= 45:
        return "light"
    if p <= 75:
        return "deep"
    return "overdrive"

AUTO_MASTI_AFTER = 25.0  # s of idle
AUTO_MASTI_FOR = 8.0     # s
SLEEP_AFTER = 300.0      # s of quiet

class StateManager:
    def __init__(self, start_time: Optional[float] = None):
        self.p: float = 8.0
        self.manual_override: bool = False
        self.masti: bool = False
        self.demo: bool = False
        self.demo_from: float = 0.0
        self.idle_since: float = start_time or time.time()
        self.auto_until: float = -1.0
        self.auto_done: bool = False
        self.temps: Dict[str, float] = {"cpu": 52.0, "gpu": 45.0}
        self.look: Optional[Dict[str, float]] = None
        self.picked_emote: Optional[Dict[str, Any]] = None  # {"emote": str, "until": float}

    def _reset(self, now: float):
        self.auto_until = -1.0
        self.auto_done = False
        self.idle_since = now

    def set_pressure(self, value: float, now: Optional[float] = None):
        now = now or time.time()
        self.p = max(0.0, min(100.0, float(value)))
        self.manual_override = True
        self.demo = False
        self.masti = False
        self._reset(now)

    def toggle_masti(self, now: Optional[float] = None) -> bool:
        now = now or time.time()
        self.masti = not self.masti
        self.demo = False
        self._reset(now)
        return self.masti

    def set_look(self, fx: Optional[float], fy: Optional[float]):
        if fx is not None and fy is not None:
            self.look = {"fx": max(0.0, min(1.0, float(fx))), "fy": max(0.0, min(1.0, float(fy)))}
        else:
            self.look = None

    def set_emote(self, name: str, duration: float = 6.0, now: Optional[float] = None):
        now = now or time.time()
        self.picked_emote = {"emote": name, "until": now + duration}

    def update_telemetry_temps(self, cpu_temp: Optional[float], gpu_temp: Optional[float]):
        if cpu_temp is not None:
            self.temps["cpu"] = cpu_temp
        if gpu_temp is not None:
            self.temps["gpu"] = gpu_temp

    def state(self, now: Optional[float] = None) -> Dict[str, Any]:
        now = now or time.time()
        idle = (mood_of(self.p) == "idle")

        if not idle:
            self._reset(now)

        if self.auto_until >= 0 and now >= self.auto_until:
            self.auto_until = -1.0
            self.auto_done = True

        if idle and not self.masti and not self.auto_done and self.auto_until < 0 and (now - self.idle_since >= AUTO_MASTI_AFTER):
            self.auto_until = now + AUTO_MASTI_FOR

        sleepy = bool(idle and not self.masti and self.auto_until < 0 and (now - self.idle_since >= SLEEP_AFTER))

        active_emote = None
        if self.picked_emote and now < self.picked_emote.get("until", 0):
            active_emote = self.picked_emote.get("emote")
        else:
            self.picked_emote = None

        return {
            "p": round(self.p, 1),
            "masti": bool(self.masti or self.auto_until >= 0),
            "demo": self.demo,
            "sleepy": sleepy,
            "temps": self.temps,
            "look": self.look,
            "emote": active_emote,
            "bridge": True,
        }
