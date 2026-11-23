"""Activity engine: pressure maths and reactions (spec §6, §3.6)."""
from bridge.activity import Activity, HALF_LIFE_S


def ev(event, tool=None, **kw):
    return {"event": event, "tool": tool, **kw}


def test_quiet_is_idle_and_system_load_counts_30_percent():
    a = Activity()
    assert a.pressure(0) == 0
    assert a.pressure(0, system_load=50) == 15  # 30 % of 50
    assert a.pressure(0, system_load=100) == 30, "load alone never goes past light work"


def test_claude_alone_can_reach_overdrive():
    a = Activity()
    for i in range(60):  # an edit every 2 s for 2 minutes: flat-out
        a.feed(ev("PostToolUse", "Edit"), 2 * i)
    assert a.pressure(120) >= 76


def test_steady_editing_reaches_deep_or_overdrive_and_decays_by_half_life():
    a = Activity()
    t = 0.0
    for _ in range(40):  # one edit every 9 s for 6 minutes (~20 weighted events/min)
        a.feed(ev("PostToolUse", "Edit"), t)
        t += 9
    p = a.pressure(t)
    assert 60 <= p <= 80, p
    score = a.score
    a.pressure(t + HALF_LIFE_S)
    assert abs(a.score - score / 2) < 1e-9, "score halves every 20 s"
    assert a.pressure(t + 300) < 1, "back to idle after 5 quiet minutes"


def test_reading_weighs_less_than_editing():
    r, e = Activity(), Activity()
    for i in range(5):
        r.feed(ev("PostToolUse", "Read"), i)
        e.feed(ev("PostToolUse", "Edit"), i)
    assert r.pressure(5) < e.pressure(5)


def test_subagents_add_15_while_running():
    a = Activity()
    assert a.feed(ev("SubagentStart", agent="a1"), 0) == {"emote": "44_magic"}
    assert a.pressure(0) == 15
    a.feed(ev("SubagentStop", agent="a1"), 1)
    assert a.pressure(1) == 0


def test_failures_confused_then_crying_and_interrupt_is_not_an_error():
    a = Activity()
    assert a.feed(ev("PostToolUseFailure", "Bash", interrupt=True), 0) is None
    assert a.feed(ev("PostToolUseFailure", "Bash"), 1)["emote"] == "08_confused"
    a.feed(ev("PostToolUseFailure", "Bash"), 2)
    assert a.feed(ev("PostToolUseFailure", "Bash"), 3)["emote"] == "05_crying"
    a.feed(ev("PostToolUse", "Bash"), 4)  # a success resets the streak
    assert a.feed(ev("PostToolUseFailure", "Bash"), 5)["emote"] == "08_confused"


def test_context_reactions():
    a = Activity()
    assert a.feed(ev("PreToolUse", "Bash", risky=True), 0) == {"emote": "40_devil", "move": "peekTurn"}
    assert a.feed(ev("PreToolUse", "WebFetch"), 0) == {"emote": "46_traveler"}
    assert a.feed(ev("Notification"), 0) == {"emote": "07_surprised", "move": "jump"}
    assert a.feed(ev("PreToolUse", "Read"), 0) is None


def test_stop_celebrates_and_flips_after_overdrive():
    a = Activity()
    assert a.feed(ev("Stop"), 0) == {"emote": "10_idea", "move": "jump"}
    for i in range(30):
        a.feed(ev("PostToolUse", "Edit"), i)
    a.pressure(30, system_load=100)  # an overdrive moment
    assert a.feed(ev("Stop"), 31) == {"emote": "04_cool", "move": "flipJump"}
    assert a.feed(ev("Stop"), 32)["move"] == "jump", "the peak resets after each Stop"
