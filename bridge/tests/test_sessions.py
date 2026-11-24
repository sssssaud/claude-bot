"""One activity per Claude Code session (pure)."""
from bridge.sessions import MAX_SESSIONS, STALE_S, Sessions, doing_for


def ev(event, session="s1", **kw):
    return {"event": event, "session": session, **kw}


def test_sessions_are_independent_and_labelled_by_folder():
    s = Sessions()
    s.feed(ev("SessionStart", "a", project="claude-bot"), 0)
    s.feed(ev("SessionStart", "b", project="insta_post"), 1)
    for i in range(10):
        s.feed(ev("PostToolUse", "a", tool="Edit"), 2 + i)
    live = {x["project"]: x for x in s.live(12)}
    assert set(live) == {"claude-bot", "insta_post"}
    assert live["claude-bot"]["pressure"] > 50 and live["insta_post"]["pressure"] == 0
    assert [x["project"] for x in s.live(12)] == ["claude-bot", "insta_post"], "oldest first: octos keep their order"


def test_two_sessions_in_one_folder_get_numbered():
    s = Sessions()
    s.feed(ev("SessionStart", "a", project="claude-bot"), 0)
    s.feed(ev("SessionStart", "b", project="claude-bot"), 1)
    assert [x["project"] for x in s.live(2)] == ["claude-bot", "claude-bot #2"]


def test_doing_follows_the_session():
    s = Sessions()
    s.feed(ev("PreToolUse", tool="Bash", project="p"), 0)
    assert s.live(0)[0]["doing"] == "Running a command"
    s.feed(ev("PostToolUse", tool="Bash"), 1)
    assert s.live(1)[0]["doing"] == "Thinking"
    s.feed(ev("Notification"), 2)
    assert s.live(2)[0]["doing"] == "Needs you"
    s.feed(ev("Stop"), 3)
    assert s.live(3)[0]["doing"] == "Done"
    assert doing_for({"event": "PreToolUse", "tool": "mcp__x__y"}) == "Working"
    assert doing_for({"event": "PostToolUseFailure", "interrupt": True}) == "Stopped"
    assert doing_for({"event": "SubagentStop"}) is None


def test_end_stale_and_cap():
    s = Sessions()
    s.feed(ev("SessionStart", "a"), 0)
    s.feed(ev("SessionEnd", "a"), 1)
    assert s.live(1) == []
    s.feed(ev("Stop", "b"), 0)
    assert s.live(STALE_S - 1) and s.live(STALE_S + 1) == [], "a crashed session disappears after 30 min"
    for i in range(MAX_SESSIONS + 2):
        s.feed(ev("SessionStart", f"x{i}"), 100 + i)
    ids = [x["id"] for x in s.live(200)]
    assert len(ids) == MAX_SESSIONS and "x0" not in ids and "x1" not in ids, "least recently active go first"


def test_missing_session_id_still_works():
    s = Sessions()
    sid, _ = s.feed({"event": "Stop"}, 0)
    assert sid == "default" and s.live(0)[0]["project"] == "Claude Code"


def att(s, now):
    x = s.live(now)[0]
    return x["attention"], x["attention_id"], x["doing"]


def test_permission_calls_the_octo_until_answered():
    s = Sessions()
    s.feed(ev("PreToolUse", tool="Bash"), 0)
    assert att(s, 0)[0] is None
    s.feed(ev("PermissionRequest", tool="Bash"), 1)
    assert att(s, 1) == ("permission", 1, "Needs permission: Bash")
    s.feed(ev("Notification", kind="permission_prompt"), 2)  # Claude Code also notifies: same episode
    s.feed(ev("SubagentStop"), 3)  # a side event doesn't answer it
    assert att(s, 3)[:2] == ("permission", 1)
    assert att(s, 600)[0] == "permission", "waits as long as it takes"
    s.feed(ev("PostToolUse", tool="Bash"), 601)  # answered (allowed): the octo can go home
    assert att(s, 601)[0] is None
    s.feed(ev("PermissionRequest", tool="Edit"), 700)
    assert att(s, 700)[:2] == ("permission", 2), "a new request is a new episode"
    s.feed(ev("PermissionRequest", tool="Write"), 700.5)
    assert att(s, 700.5)[:2] == ("permission", 3), "so is a second request while the first is still open"
    s.feed(ev("PostToolUseFailure", tool="Edit"), 701)  # denied: also answered
    assert att(s, 701)[0] is None


def test_done_calls_the_octo_for_a_few_seconds():
    from bridge.sessions import DONE_S
    s = Sessions()
    s.feed(ev("Stop"), 10)
    assert att(s, 10)[:2] == ("done", 1)
    assert att(s, 10 + DONE_S - 0.1)[0] == "done"
    assert att(s, 10 + DONE_S + 0.1)[0] is None
    s.feed(ev("UserPromptSubmit"), 30)
    s.feed(ev("Stop"), 40)
    assert att(s, 40)[:2] == ("done", 2), "every finished turn is a new episode"
    s.feed(ev("UserPromptSubmit"), 41)
    assert att(s, 41)[0] is None, "a new prompt sends it home early"


def test_idle_notification_is_not_a_permission():
    s = Sessions()
    s.feed(ev("Notification", kind="idle_prompt"), 0)
    assert att(s, 0) == (None, 0, "Needs you")
