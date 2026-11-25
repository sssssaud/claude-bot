"""A session octo's own feelings (Saud's pick, 2026-11-25): energy and happiness, 0–100. Pure: time passed in.

Events nudge them (an error, a fix, a finished task); situations change them per minute (working hard, late at
night, waiting for Saud, resting). Both drift back toward NEUTRAL, so a bad hour is forgotten. `why` keeps the
latest reason, so the popup can say why the octo feels this way.
"""
NEUTRAL = 70.0  # a normal octo: fairly awake, fairly happy
DRIFT_HALF_S = 15 * 60  # half of any difference from NEUTRAL is gone after this long

# per minute, while the situation lasts
WORKING_HARD = -3.0  # energy, while pressure is in overdrive (> 75)
LATE_NIGHT = -2.0  # energy, while working between midnight and 5 am
RESTING = +3.0  # energy, while idle (pressure ≤ 15, no turn running)
WAITING = -2.0  # happiness, while a permission waits unanswered (after 60 s)

# one-off nudges
ERROR = -4.0  # happiness, per failed tool
ERRORS_IN_A_ROW = -8.0  # happiness, from the 3rd failure in a row
FIXED = +10.0  # happiness, a tool works again after errors
DONE = +8.0  # happiness, a turn finished
LONG_TASK = -6.0  # energy, a turn that took 10+ minutes of work
REASON_S = 120  # an event's reason ("3 errors in a row") stays this long before a situation's replaces it


class Feelings:
    def __init__(self, now: float):
        self.energy = self.happiness = NEUTRAL
        self.at = now
        self.why = "just started"
        self.why_at = float("-inf")  # when an event last gave the reason

    def _drift(self, now: float):
        if now > self.at:
            k = 0.5 ** ((now - self.at) / DRIFT_HALF_S)
            self.energy = NEUTRAL + (self.energy - NEUTRAL) * k
            self.happiness = NEUTRAL + (self.happiness - NEUTRAL) * k
        self.at = now

    def nudge(self, now: float, why: str, energy: float = 0.0, happiness: float = 0.0, situation: bool = False):
        self._drift(now)
        self.energy = max(0.0, min(100.0, self.energy + energy))
        self.happiness = max(0.0, min(100.0, self.happiness + happiness))
        if not situation:
            self.why, self.why_at = why, now
        elif now - self.why_at >= REASON_S:  # the specific event's reason first, then the ongoing situation's
            self.why = why

    def tick(self, now: float, pressure: float, working: bool, waiting_long: bool, hour: int):
        """Called about once a second: the per-minute situations, scaled to the time since the last call."""
        minutes = max(0.0, now - self.at) / 60
        if waiting_long:
            self.nudge(now, "waiting for you", happiness=WAITING * minutes, situation=True)
        elif working and hour < 5:
            self.nudge(now, "it's late", energy=(LATE_NIGHT + (WORKING_HARD if pressure > 75 else 0)) * minutes, situation=True)
        elif pressure > 75:
            self.nudge(now, "working hard", energy=WORKING_HARD * minutes, situation=True)
        elif pressure <= 15 and not working:
            self.nudge(now, "resting", energy=RESTING * minutes, situation=True)
        else:
            self._drift(now)

    def snapshot(self) -> dict:
        return {"energy": round(self.energy), "happiness": round(self.happiness), "why": self.why}
