#!/usr/bin/env python3
"""Claude Code hook → claude-bot bridge. Registered for UserPromptSubmit, PreToolUse, PostToolUse,
PostToolUseFailure, Stop, SubagentStart, SubagentStop, Notification, SessionStart, SessionEnd and
PermissionRequest. Prints nothing, so it can never answer a permission request (that needs a JSON decision on stdout)
(see hooks/README.md).

Rules: never slow Claude Code (0.3 s budget, bridge down = instant refusal), always exit 0, never
print to stdout (for some events Claude Code reads stdout as instructions). Privacy: only the event
name, the tool name, yes/no flags, the session id, the project folder's NAME, the parent process ids (to find the
terminal window) and a short "detail" leave this script. The detail (Saud's option 2, 2026-11-25) is Claude's own
one-line summary of a command or sub-agent, or a file's NAME: never the command, never a path, dropped if it looks
like a secret. A Bash command is checked for risky patterns here; its text is never sent. Standard library only.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

URL = "http://127.0.0.1:8765/event"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.path.expanduser("~/.cache/claude-bot.log")
DELIVER_S = 30  # a bot started by a session is up in ~3–5 s
MAX_PIDS = 8


def ancestors(pid: int) -> list:
    """Process ids above `pid` (its parent first), up to systemd. The app finds the session's terminal
    window among them (the eyes look at it). Only numbers leave; /proc reads, no subprocess."""
    out = []
    while pid > 1 and len(out) < MAX_PIDS:
        try:
            with open(f"/proc/{pid}/stat") as f:
                stat = f.read()
        except OSError:
            break
        name = stat[stat.index("(") + 1: stat.rindex(")")]
        if name == "systemd":
            break
        out.append(pid)
        pid = int(stat[stat.rindex(")") + 2:].split()[1])  # field 4: ppid
    return out
TIMEOUT_S = 0.3
RISKY = re.compile(r"\brm\s+-\w*(rf|fr)\w*\b|\bgit\s+push\b.*(--force\b|\s-f\b)|\bsudo\b")
SUMMARY_TOOLS = {"Bash", "Agent", "Task"}  # these carry Claude's one-line "description"
FILE_TOOLS = {"Read", "Edit", "Write", "MultiEdit", "NotebookEdit"}
SECRETISH = re.compile(r"sk-|gh[pousr]_|github_pat_|xox[abpr]-|AKIA|AIza|-----BEGIN|[A-Za-z0-9+/_=-]{32,}"
                       r"|(pass(word|wd)?|secret|token|api[_-]?key)\s*[:=]", re.I)


def detail(tool, tool_input) -> str:
    """What the octo may say about this tool call: Claude's summary, or a file's name. "" = nothing."""
    if not isinstance(tool_input, dict):
        return ""
    if tool in SUMMARY_TOOLS:
        text = tool_input.get("description")
    elif tool in FILE_TOOLS:
        path = tool_input.get("file_path") or tool_input.get("notebook_path")
        text = os.path.basename(path.rstrip("/")) if isinstance(path, str) else ""
    else:
        return ""  # searches, web queries, everything else: their text stays private
    if not isinstance(text, str):
        return ""
    # any word with a "/" keeps only its last part: "/home/x/app/main.js" -> "main.js" (no path leaves)
    text = " ".join(w.rstrip("/").rsplit("/", 1)[-1] or w for w in text.split())[:60]
    return "" if SECRETISH.search(text) else text


def summarize(p: dict) -> dict:
    ev = {"event": p.get("hook_event_name")}
    tool = p.get("tool_name")
    if isinstance(tool, str):
        ev["tool"] = tool[:64]
    if ev["event"] == "PostToolUseFailure":
        ev["interrupt"] = bool(p.get("is_interrupt"))  # Esc pressed: not a real error
    if ev["event"] == "PreToolUse" and tool == "Bash":
        cmd = (p.get("tool_input") or {}).get("command")
        ev["risky"] = isinstance(cmd, str) and bool(RISKY.search(cmd))
    if isinstance(p.get("session_id"), str):
        ev["session"] = p["session_id"][:64]  # one octo per session
    folder = os.path.basename(p["cwd"].rstrip("/")) if isinstance(p.get("cwd"), str) else ""
    if folder:
        ev["project"] = folder[:40]  # the folder's name only, never the path
    if ev["event"] == "Notification" and isinstance(p.get("notification_type"), str):
        ev["kind"] = p["notification_type"][:40]  # e.g. permission_prompt, idle_prompt (never the message)
    if ev["event"] in ("PreToolUse", "PermissionRequest"):
        d = detail(tool, p.get("tool_input"))
        if d:
            ev["detail"] = d
    if isinstance(p.get("agent_id"), str):
        ev["agent"] = p["agent_id"][:64]
    pids = ancestors(os.getppid())
    if pids:
        ev["pids"] = pids
    return ev


def post(data: bytes):
    req = urllib.request.Request(URL, data=data, headers={"Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=TIMEOUT_S).close()


def start_bot(data: bytes):
    """Saud 2026-11-25: opening a session starts the bot if it isn't running. Its own process session, so it
    outlives Claude Code; a second start is harmless (single-instance app, bridge port already taken). A small
    helper waits for the bridge and delivers this SessionStart, so the octo comes with the session.
    ponytail: Quit from the tray lasts until the next session opens; add an opt-out if that ever annoys."""
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, "ab") as log:
        subprocess.Popen([os.path.join(ROOT, "run.sh")], cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log,
                         stderr=log, start_new_session=True)
    subprocess.Popen([sys.executable, "-I", os.path.abspath(__file__), "--deliver", data.decode()],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True)


def deliver(data: bytes, wait_s: float = DELIVER_S):
    """The helper: retry the event until the just-started bridge answers (or give up quietly)."""
    end = time.monotonic() + wait_s
    while time.monotonic() < end:
        try:
            return post(data)
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(0.5)


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--deliver":
        deliver(sys.argv[2].encode())
        sys.exit(0)
    try:
        payload = json.load(sys.stdin)
        data = json.dumps(summarize(payload)).encode()
        try:
            post(data)
        except urllib.error.URLError as e:  # refused = no bot running: a new session starts it
            if payload.get("hook_event_name") == "SessionStart" and isinstance(e.reason, ConnectionRefusedError):
                start_bot(data)
            raise
    except (urllib.error.URLError, TimeoutError, ConnectionError):
        pass  # bridge not running or busy: normal, stay silent
    except Exception as e:  # anything else is a bug in this script: report it, never break Claude Code
        print(f"claude-bot hook: {type(e).__name__}: {e}", file=sys.stderr)
    sys.exit(0)


if __name__ == "__main__":
    main()
