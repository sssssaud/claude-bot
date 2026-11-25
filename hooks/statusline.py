#!/usr/bin/env python3
"""Claude Code status line wrapper: sends token usage to the claude-bot bridge, then runs the status
line you already had (e.g. ponytail's) with the same input and prints its output unchanged.

    "statusLine": {"type": "command",
                   "command": "python3 -I /path/hooks/statusline.py bash /path/ponytail-statusline.sh"}

Sent: rate_limits.five_hour / seven_day {used_percentage, resets_at} and context_window.used_percentage.
Nothing else (no paths, prompts or session ids). Bridge down: your status line still works.
"""
import json
import re
import subprocess
import sys
import threading
import urllib.error
import urllib.request

URL = "http://127.0.0.1:8765/usage"
TIMEOUT_S = 0.3


def usage_of(data: dict) -> dict:
    out = {}
    limits = data.get("rate_limits") or {}
    for key in ("five_hour", "seven_day"):
        v = limits.get(key)
        if isinstance(v, dict) and isinstance(v.get("used_percentage"), (int, float)):
            out[key] = {"used_percentage": v["used_percentage"],
                        "resets_at": v["resets_at"] if isinstance(v.get("resets_at"), int) else None}
    ctx = (data.get("context_window") or {}).get("used_percentage")
    if isinstance(ctx, (int, float)):
        out["context"] = ctx
    sid = data.get("session_id")
    if out and isinstance(sid, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,64}", sid):
        out["session"] = sid  # the octo of this session knows its own context fullness
    return out


def send(raw: str):
    try:
        usage = usage_of(json.loads(raw))
        if usage:
            req = urllib.request.Request(URL, data=json.dumps(usage).encode(), headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=TIMEOUT_S).close()
    except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError):
        pass  # bridge not running, or no JSON: the status line itself must still print
    except Exception as e:
        print(f"claude-bot statusline: {type(e).__name__}: {e}", file=sys.stderr)


def main():
    raw = sys.stdin.read()
    sender = threading.Thread(target=send, args=(raw,), daemon=True)
    sender.start()  # in parallel with the wrapped status line, so it adds no delay
    if len(sys.argv) > 1:
        try:
            res = subprocess.run(sys.argv[1:], input=raw, capture_output=True, text=True, timeout=5)
            sys.stdout.write(res.stdout)
        except (OSError, subprocess.TimeoutExpired) as e:
            print(f"claude-bot statusline: wrapped command failed: {e}", file=sys.stderr)
    sender.join(TIMEOUT_S + 0.1)


if __name__ == "__main__":
    main()
