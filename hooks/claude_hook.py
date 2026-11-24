#!/usr/bin/env python3
"""Claude Code hook → claude-bot bridge. Registered for UserPromptSubmit, PreToolUse, PostToolUse,
PostToolUseFailure, Stop, SubagentStart, SubagentStop, Notification, SessionStart and SessionEnd
(see hooks/README.md).

Rules: never slow Claude Code (0.3 s budget, bridge down = instant refusal), always exit 0, never
print to stdout (for some events Claude Code reads stdout as instructions). Privacy: only the event
name, the tool name, yes/no flags, the session id and the project folder's NAME leave this script. A Bash command is checked for risky
patterns here; its text is never sent. Standard library only.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

URL = "http://127.0.0.1:8765/event"
TIMEOUT_S = 0.3
RISKY = re.compile(r"\brm\s+-\w*(rf|fr)\w*\b|\bgit\s+push\b.*(--force\b|\s-f\b)|\bsudo\b")


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
    if isinstance(p.get("agent_id"), str):
        ev["agent"] = p["agent_id"][:64]
    return ev


def main():
    try:
        payload = json.load(sys.stdin)
        data = json.dumps(summarize(payload)).encode()
        req = urllib.request.Request(URL, data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=TIMEOUT_S).close()
    except (urllib.error.URLError, TimeoutError, ConnectionError):
        pass  # bridge not running or busy: normal, stay silent
    except Exception as e:  # anything else is a bug in this script: report it, never break Claude Code
        print(f"claude-bot hook: {type(e).__name__}: {e}", file=sys.stderr)
    sys.exit(0)


if __name__ == "__main__":
    main()
