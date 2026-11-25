"""Claude Code side: hook + status line scripts, /event and /usage endpoints, config loading."""
import importlib.util
import io
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

from bridge.server import BridgeApp, load_config, DEFAULT_THRESHOLDS

HOOKS = Path(__file__).resolve().parents[2] / "hooks"


def load(name):
    spec = importlib.util.spec_from_file_location(name, HOOKS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def capture():
    """A throwaway local HTTP server that records what the scripts POST."""
    got = []

    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            got.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}", got
    srv.shutdown()


def run_main(mod, payload, monkeypatch, argv=None):
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps(payload)))
    out = io.StringIO()
    monkeypatch.setattr(sys, "stdout", out)
    monkeypatch.setattr(sys, "argv", ["x", *(argv or [])])
    code = None
    try:
        mod.main()
    except SystemExit as e:
        code = e.code
    return code, out.getvalue()


def test_hook_sends_only_names_and_flags(capture, monkeypatch):
    url, got = capture
    hook = load("claude_hook")
    monkeypatch.setattr(hook, "URL", url)
    payload = {"hook_event_name": "PreToolUse", "tool_name": "Bash", "session_id": "s1", "prompt": "secret",
               "cwd": "/home/me/secret/claude-bot", "tool_input": {"command": "sudo rm -rf /tmp/x # my secret path"}}
    code, out = run_main(hook, payload, monkeypatch)
    assert code == 0 and out == "", "exit 0 and never print to stdout"
    pids = got[0].pop("pids")
    assert pids and all(isinstance(p, int) for p in pids), "parent process ids, numbers only"
    assert got == [{"event": "PreToolUse", "tool": "Bash", "risky": True, "session": "s1", "project": "claude-bot"}]
    assert "secret" not in json.dumps(got), "no prompt, command or path leaves the hook"


@pytest.mark.parametrize("cmd,risky", [("rm -rf build", True), ("rm -fr x", True), ("git push --force", True),
                                       ("git push -f origin main", True), ("sudo dnf install x", True),
                                       ("rm -r build", False), ("git push origin main", False), ("ls -rf", False)])
def test_risky_patterns(cmd, risky):
    hook = load("claude_hook")
    assert hook.summarize({"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": cmd}})["risky"] is risky


def test_hook_is_fast_and_silent_when_the_bridge_is_down(monkeypatch):
    hook = load("claude_hook")
    monkeypatch.setattr(hook, "URL", "http://127.0.0.1:9/event")  # nothing listens on port 9
    t = time.monotonic()
    code, out = run_main(hook, {"hook_event_name": "Stop"}, monkeypatch)
    assert code == 0 and out == "" and time.monotonic() - t < 0.5


def test_statusline_passes_the_wrapped_output_through_and_sends_usage(capture, monkeypatch):
    url, got = capture
    sl = load("statusline")
    monkeypatch.setattr(sl, "URL", url)
    payload = {"model": {"id": "x"}, "cwd": "/home/me/secret",
               "rate_limits": {"five_hour": {"used_percentage": 46, "resets_at": 1790000000},
                               "seven_day": {"used_percentage": 86.5, "resets_at": 1790500000}},
               "context_window": {"used_percentage": 12.5}}
    code, out = run_main(sl, payload, monkeypatch, argv=["cat"])  # `cat` stands in for ponytail's script
    assert json.loads(out) == payload, "the wrapped status line gets the same input and prints unchanged"
    assert got == [{"five_hour": {"used_percentage": 46, "resets_at": 1790000000},
                    "seven_day": {"used_percentage": 86.5, "resets_at": 1790500000}, "context": 12.5}]


@pytest.fixture
async def cli(aiohttp_client):
    return await aiohttp_client(BridgeApp(mock=True).app)


async def test_event_endpoint_validates_and_broadcasts_reactions(cli):
    ws = await cli.ws_connect("/ws")
    await ws.receive_json()  # init
    assert (await cli.post("/event", json={"event": "Stop"})).status == 200
    while (msg := await ws.receive_json(timeout=2))["type"] != "cmd":
        pass
    assert msg == {"type": "cmd", "cmd": "react", "session": "default", "emote": "10_idea", "move": "jump"}
    for bad in ({"event": "Nope"}, {"event": "PreToolUse", "tool": "rm -rf /"}, {"event": "PreToolUse", "risky": "yes"}, {},
                {"event": "Stop", "project": "/home/me/secret"}, {"event": "Stop", "session": "a b"},
                {"event": "Stop", "pids": [1]}, {"event": "Stop", "pids": ["4740"]}, {"event": "Stop", "pids": list(range(2, 12))},
                {"event": "PreToolUse", "detail": "line\nbreak"}, {"event": "PreToolUse", "detail": "x" * 61}, {"event": "PreToolUse", "detail": 5}):
        assert (await cli.post("/event", json=bad)).status == 400, bad
    await ws.close()


async def test_usage_endpoint_validates_and_reaches_new_clients(cli):
    good = {"five_hour": {"used_percentage": 46, "resets_at": 1790000000}, "context": 12.5}
    assert (await cli.post("/usage", json=good)).status == 200
    ws = await cli.ws_connect("/ws")
    init = await ws.receive_json()
    assert init["usage"]["five_hour"] == good["five_hour"] and init["usage"]["context"] == 12.5
    assert init["config"]["thresholds"]["tokens_warning_percent"] == 80
    for bad in ({}, {"five_hour": 46}, {"five_hour": {"used_percentage": -1}},
                {"seven_day": {"used_percentage": 50, "resets_at": "soon"}}, {"context": 101}):
        assert (await cli.post("/usage", json=bad)).status == 400, bad
    await ws.close()


def test_config_falls_back_to_defaults(tmp_path):
    assert load_config(tmp_path / "missing.json")["thresholds"] == DEFAULT_THRESHOLDS
    (tmp_path / "c.json").write_text('{"thresholds": {"cpu_temp_alert": 85, "ram_percent_alert": "high"}}')
    t = load_config(tmp_path / "c.json")["thresholds"]
    assert t["cpu_temp_alert"] == 85 and t["ram_percent_alert"] == 90
    (tmp_path / "bad.json").write_text("{not json")
    assert load_config(tmp_path / "bad.json")["thresholds"] == DEFAULT_THRESHOLDS


def test_hook_sends_the_notification_kind_but_never_the_message():
    hook = load("claude_hook")
    out = hook.summarize({"hook_event_name": "Notification", "notification_type": "permission_prompt",
                          "message": "Claude needs your permission to use Bash: rm secret.txt"})
    out.pop("pids")
    assert out == {"event": "Notification", "kind": "permission_prompt"}


def test_config_attention_flags(tmp_path):
    (tmp_path / "c.json").write_text('{"attention": {"come_when_done": false, "come_for_permission": "yes"}}')
    a = load_config(tmp_path / "c.json")["attention"]
    assert a == {"come_for_permission": True, "come_when_done": False}, "bad value falls back to the default"


def test_hook_detail_is_claudes_summary_or_a_file_name_never_the_command():
    """Saud's option 2 (2026-11-25): the octo says what's happening in Claude's words, privacy kept."""
    hook = load("claude_hook")
    def detail(tool, tool_input, event="PreToolUse"):
        return hook.summarize({"hook_event_name": event, "tool_name": tool, "tool_input": tool_input}).get("detail")
    bash = {"command": "cd /home/me/secret && pytest -q", "description": "Run the bridge tests"}
    assert detail("Bash", bash) == "Run the bridge tests"
    assert detail("Bash", bash, "PermissionRequest") == "Run the bridge tests", "the octo can say what wants permission"
    assert detail("Bash", bash, "PostToolUse") is None, "only for the moment a tool starts or asks"
    assert detail("Edit", {"file_path": "/home/me/secret/app/main.js"}) == "main.js"
    assert detail("Agent", {"description": "Explore the codebase", "prompt": "long private brief"}) == "Explore the codebase"
    # a word with "/" keeps its last part, so no full path leaves (a folder name with a space keeps its middle word)
    assert detail("Bash", {"description": "Read /home/me/my secret dir/notes.md now"}) == "Read my secret notes.md now"
    for private in ({"description": "Export API_KEY=abc"}, {"description": "Use sk-ant-0123"}, {"description": "Push with ghp_abc"},
                    {"description": "Fetch " + "a1B2" * 9}, {"description": "Set password: hunter2"}, {"command": "ls"}, {}):
        assert detail("Bash", private) is None, private
    assert detail("Grep", {"pattern": "secret", "path": "/home/me"}) is None, "search text stays private"
    assert detail("WebSearch", {"query": "private question"}) is None
    assert len(detail("Bash", {"description": "word " * 40})) == 60


async def test_a_new_sessions_status_line_does_not_wipe_the_limits(cli, monkeypatch):
    """Saud 2026-11-25: two new sessions blanked Session/Week. A fresh session's status line has no
    rate_limits yet (context only); the account's limits must survive it, and its old time stamp too."""
    from bridge import server
    monkeypatch.setattr(server.time, "time", lambda: 1_795_000_000)
    full = {"five_hour": {"used_percentage": 45, "resets_at": 1_795_010_000},
            "seven_day": {"used_percentage": 31, "resets_at": 1_795_500_000}, "context": 47}
    assert (await cli.post("/usage", json=full)).status == 200
    monkeypatch.setattr(server.time, "time", lambda: 1_795_000_600)
    assert (await cli.post("/usage", json={"context": 3})).status == 200
    ws = await cli.ws_connect("/ws")
    u = (await ws.receive_json())["usage"]
    assert u["five_hour"] == full["five_hour"] and u["seven_day"] == full["seven_day"], "limits kept"
    assert u["context"] == 3 and u["received_at"] == 1_795_000_000, "limits' time stamp: when they last arrived"
    monkeypatch.setattr(server.time, "time", lambda: 1_795_020_000)  # the 5-hour window has reset since
    assert (await cli.post("/usage", json={"context": 4})).status == 200
    u = (await (await cli.ws_connect("/ws")).receive_json())["usage"]
    assert "five_hour" not in u and u["seven_day"] == full["seven_day"], "a reset window's old number is dropped"
    await ws.close()
