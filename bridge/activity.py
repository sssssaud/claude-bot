"""Claude Code activity → pressure (0–100) and reactions. Pure: no I/O, time passed in (spec §6, §3.6).

Pressure: every hook event adds its weight to a score that halves every 20 s (an EMA of weighted
events per minute). The score maps onto 0–100 so steady editing (~20 weighted events a minute)
lands near deep/overdrive. Running sub-agents add +15 each. System load (busiest of CPU/GPU) is
added on top (up to 30 points) so local model runs and builds count too.
"""
import math
from typing import Optional

HALF_LIFE_S = 20.0
TAU = HALF_LIFE_S / math.log(2)
SCALE = 6.9  # score at which pressure ≈ 63 %; ~20 weighted events/min → ≈ 75
SUBAGENT_BONUS = 15.0
SYSTEM_SHARE = 0.3
WEIGHTS = {"Edit": 3, "Write": 3, "MultiEdit": 3, "NotebookEdit": 3, "Bash": 2,
           "Read": 1, "Grep": 1, "Glob": 1, "WebSearch": 1, "WebFetch": 1}
WEB_TOOLS = {"WebSearch", "WebFetch"}
EVENTS = {"UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop",
          "SubagentStart", "SubagentStop", "Notification", "SessionStart", "SessionEnd", "PermissionRequest"}


class Activity:
    def __init__(self):
        self.score = 0.0
        self.at = None  # time of the last decay step
        self.subagents = set()
        self.failures = 0  # consecutive failed tools
        self.peak = 0.0  # highest pressure since the last Stop (for the flipJump)
        self.last_event = None

    def _decay(self, now: float):
        if self.at is not None and now > self.at:
            self.score *= math.exp(-(now - self.at) / TAU)
        self.at = now

    def pressure(self, now: float, system_load: float = 0.0) -> float:
        """0–100. system_load: busiest of CPU/GPU utilisation in %."""
        self._decay(now)
        hooks = 100 * (1 - math.exp(-self.score / SCALE)) + SUBAGENT_BONUS * len(self.subagents)
        # added, not averaged: averaging capped Claude-only work at 70, so overdrive was unreachable
        p = min(100.0, hooks + SYSTEM_SHARE * max(0.0, min(100.0, system_load)))
        self.peak = max(self.peak, p)
        return p

    def feed(self, ev: dict, now: float) -> Optional[dict]:
        """One hook event (already validated). Returns a reaction {emote, move?} or None."""
        self._decay(now)
        self.last_event = now
        kind, tool = ev["event"], ev.get("tool") or ""
        if kind == "PostToolUse":
            self.score += WEIGHTS.get(tool, 1)
            recovered = self.failures >= 2
            self.failures = 0
            if recovered:  # it works again after errors: relief (Saud's session moments, 2026-11-25)
                return {"emote": "22_healing", "move": "jump"}
        elif kind == "PostToolUseFailure":
            self.score += WEIGHTS.get(tool, 1)
            if ev.get("interrupt"):  # Saud pressed Esc: not an error
                return None
            self.failures += 1
            return {"emote": "05_crying" if self.failures >= 3 else "08_confused", "move": "bounce"}
        elif kind == "UserPromptSubmit":
            self.score += 1
        elif kind == "PreToolUse":
            if ev.get("risky"):
                return {"emote": "40_devil", "move": "peekTurn"}
            if tool in WEB_TOOLS:
                return {"emote": "46_traveler"}
        elif kind == "SubagentStart":
            self.subagents.add(ev.get("agent") or "?")
            return {"emote": "44_magic"}
        elif kind == "SubagentStop":
            self.subagents.discard(ev.get("agent") or "?")
        elif kind == "Notification":
            return {"emote": "07_surprised", "move": "jump"}
        elif kind == "Stop":
            long_or_hot = self.peak >= 76
            self.peak = 0.0
            self.subagents.clear()  # nothing keeps running once the turn ends
            return {"emote": "04_cool" if long_or_hot else "10_idea", "move": "flipJump" if long_or_hot else "jump"}
        return None
