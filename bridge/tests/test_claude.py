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
               "tool_input": {"command": "sudo rm -rf /tmp/x # my secret path"}}
    code, out = run_main(hook, payload, monkeypatch)
    assert code == 0 and out == "", "exit 0 and never print to stdout"
    assert got == [{"event": "PreToolUse", "tool": "Bash", "risky": True}]
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
    assert msg == {"type": "cmd", "cmd": "react", "emote": "10_idea", "move": "jump"}
    for bad in ({"event": "Nope"}, {"event": "PreToolUse", "tool": "rm -rf /"}, {"event": "PreToolUse", "risky": "yes"}, {}):
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
