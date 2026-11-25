"""The octo's own feelings: energy and happiness (Saud's pick, 2026-11-25). Pure, time faked."""
from bridge import feelings
from bridge.feelings import DRIFT_HALF_S, NEUTRAL, Feelings
from bridge.sessions import LONG_TURN_S, Sessions


def test_nudges_are_clamped_and_drift_back_to_normal():
    f = Feelings(0)
    f.nudge(0, "a test", happiness=-500)
    assert f.snapshot() == {"energy": 70, "happiness": 0, "why": "a test"}
    f.nudge(DRIFT_HALF_S, "later")
    assert round(f.happiness) == round(NEUTRAL / 2), "half the difference gone after DRIFT_HALF_S"
    f.nudge(10 * DRIFT_HALF_S, "much later")
    assert round(f.happiness) == NEUTRAL


def test_situations_per_minute():
    f = Feelings(0)
    for t in range(1, 601):  # 10 minutes of overdrive, ticked every second like the bridge does
        f.tick(t, pressure=90, working=True, waiting_long=False, hour=14)
    assert f.why == "working hard" and 40 < f.energy < 50, f.energy
    late = Feelings(0)
    for t in range(1, 601):
        late.tick(t, pressure=50, working=True, waiting_long=False, hour=2)
    assert late.why == "it's late" and late.energy < 60
    rest = Feelings(0)
    rest.nudge(0, "tired", energy=-50)
    for t in range(1, 601):
        rest.tick(t, pressure=5, working=False, waiting_long=False, hour=14)
    assert rest.why == "resting" and rest.energy > 45, "resting brings energy back"
    wait = Feelings(0)
    for t in range(1, 301):
        wait.tick(t, pressure=50, working=True, waiting_long=True, hour=14)
    assert wait.why == "waiting for you" and wait.happiness < 63
    calm = Feelings(0)
    for t in range(1, 61):
        calm.tick(t, pressure=40, working=True, waiting_long=False, hour=14)
    assert calm.snapshot() == {"energy": 70, "happiness": 70, "why": "just started"}, "normal work: no change"


def test_session_events_move_its_octos_feelings():
    s = Sessions()
    feel = lambda now: s.live(now, 0, None, 14)[0]["feel"]
    ev = lambda event, **kw: {"event": event, "session": "s1", "tool": "Bash", **kw}
    s.feed(ev("UserPromptSubmit", project="p"), 0)
    s.feed(ev("PostToolUseFailure"), 1)
    assert feel(1)["why"] == "an error" and feel(1)["happiness"] == 66
    s.feed(ev("PostToolUseFailure"), 2)
    s.feed(ev("PostToolUseFailure"), 3)
    assert feel(3)["why"] == "3 errors in a row" and feel(3)["happiness"] < 55
    s.feed(ev("PostToolUseFailure", interrupt=True), 4)
    assert feel(4)["why"] == "3 errors in a row", "Esc is not an error"
    s.feed(ev("PostToolUse"), 5)
    assert feel(5)["why"] == "fixed it after errors"
    s.feed(ev("Stop"), 6)
    assert feel(6)["why"] == "finished a task" and feel(6)["energy"] == 70
    s.feed(ev("UserPromptSubmit"), 10)
    s.feed(ev("Stop"), 10 + LONG_TURN_S)
    after = s.by_id["s1"]["feel"]
    assert after.why == "finished a long task" and after.energy < 70 + feelings.LONG_TASK + 1


def test_an_events_reason_outlives_the_situation_for_a_while():
    f = Feelings(0)
    f.nudge(0, "3 errors in a row", happiness=-8)
    f.tick(1, pressure=90, working=True, waiting_long=False, hour=14)
    assert f.why == "3 errors in a row" and f.energy < 70, "energy still drains, the specific reason stays"
    f.tick(feelings.REASON_S + 1, pressure=90, working=True, waiting_long=False, hour=14)
    assert f.why == "working hard"


def test_a_turn_already_running_when_the_bridge_starts_counts_as_work_not_rest():
    s = Sessions()
    s.feed({"event": "PreToolUse", "session": "s1", "tool": "Bash", "project": "p"}, 0)  # no UserPromptSubmit seen
    assert s.live(30, 0, None, 14)[0]["feel"]["why"] != "resting"
    s.feed({"event": "Stop", "session": "s1"}, 40)
    for t in range(41, 200):
        s.live(t, 0, None, 14)
    assert s.live(200, 0, None, 14)[0]["feel"]["why"] in ("finished a task", "resting")
