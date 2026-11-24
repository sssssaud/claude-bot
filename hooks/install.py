#!/usr/bin/env python3
"""Add (or remove) claude-bot's Claude Code hooks and status line wrapper in ~/.claude/settings.json.

    python3 hooks/install.py --dry-run     # show what would change, touch nothing
    python3 hooks/install.py               # back up settings.json, then install
    python3 hooks/install.py --uninstall   # remove exactly what install added

Existing hooks (e.g. Mission Control's) and the existing status line (e.g. ponytail's) are kept:
the status line is wrapped, not replaced. Running install twice changes nothing.
"""
import argparse
import copy
import json
import os
import shlex
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOOK = HERE / "claude_hook.py"
STATUSLINE = HERE / "statusline.py"
SETTINGS = Path.home() / ".claude" / "settings.json"
TOOL_EVENTS = ("PreToolUse", "PostToolUse", "PostToolUseFailure")
OTHER_EVENTS = ("UserPromptSubmit", "Stop", "SubagentStart", "SubagentStop", "Notification", "SessionStart", "SessionEnd", "PermissionRequest")


def hook_command(hook: Path = HOOK) -> str:
    return f"python3 -I {shlex.quote(str(hook))}"


def is_ours(entry: dict) -> bool:
    return "claude_hook.py" in str(entry.get("command", ""))


def wrapped(command: str, statusline: Path = STATUSLINE) -> str:
    return f"python3 -I {shlex.quote(str(statusline))} sh -c {shlex.quote(command)}"


def unwrap(command: str):
    """The original status line command if `command` is our wrapper, else None."""
    parts = shlex.split(command)
    if len(parts) == 6 and parts[:2] == ["python3", "-I"] and parts[2].endswith("statusline.py") and parts[3:5] == ["sh", "-c"]:
        return parts[5]
    return None


def install(settings: dict, hook: Path = HOOK, statusline: Path = STATUSLINE) -> dict:
    s = copy.deepcopy(settings)
    hooks = s.setdefault("hooks", {})
    for event in TOOL_EVENTS + OTHER_EVENTS:
        groups = hooks.setdefault(event, [])
        if any(is_ours(h) for g in groups for h in g.get("hooks", [])):
            continue
        group = {"hooks": [{"type": "command", "command": hook_command(hook), "timeout": 2}]}
        if event in TOOL_EVENTS:
            group = {"matcher": "*", **group}
        groups.append(group)
    sl = s.get("statusLine")
    if isinstance(sl, dict) and sl.get("type") == "command" and isinstance(sl.get("command"), str):
        if unwrap(sl["command"]) is None:
            s["statusLine"] = {**sl, "command": wrapped(sl["command"], statusline)}
    elif sl is None:
        s["statusLine"] = {"type": "command", "command": f"python3 -I {shlex.quote(str(statusline))}"}
    else:
        print("statusLine has an unexpected shape; left as is (token usage won't update)", file=sys.stderr)
    return s


def uninstall(settings: dict) -> dict:
    s = copy.deepcopy(settings)
    hooks = s.get("hooks", {})
    for event in list(hooks):
        groups = []
        for g in hooks[event]:
            kept = [h for h in g.get("hooks", []) if not is_ours(h)]
            if kept:
                groups.append({**g, "hooks": kept})
            elif not g.get("hooks"):
                groups.append(g)  # an empty group that wasn't ours: leave it
        if groups:
            hooks[event] = groups
        else:
            del hooks[event]
    if not hooks and "hooks" in s:
        del s["hooks"]
    sl = s.get("statusLine")
    if isinstance(sl, dict) and isinstance(sl.get("command"), str):
        original = unwrap(sl["command"])
        if original is not None:
            s["statusLine"] = {**sl, "command": original}
        elif sl["command"] == f"python3 -I {shlex.quote(str(STATUSLINE))}":
            del s["statusLine"]
    return s


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--uninstall", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--settings", type=Path, default=SETTINGS)
    args = ap.parse_args()

    try:
        current = json.loads(args.settings.read_text()) if args.settings.exists() else {}
    except json.JSONDecodeError as e:
        sys.exit(f"{args.settings} is not valid JSON ({e}); fix it first, nothing changed")
    new = uninstall(current) if args.uninstall else install(current)
    if new == current:
        print("nothing to change")
        return
    before = {k: current.get(k) for k in ("hooks", "statusLine")}
    after = {k: new.get(k) for k in ("hooks", "statusLine")}
    print(json.dumps({"before": before, "after": after}, indent=2))
    if args.dry_run:
        print("(dry run: nothing written)")
        return
    if args.settings.exists():
        backup = args.settings.with_name(f"{args.settings.name}.bak-claude-bot-{time.strftime('%Y%m%d-%H%M%S')}")
        backup.write_text(args.settings.read_text())
        print(f"backup: {backup}")
    tmp = args.settings.with_name(args.settings.name + ".tmp")
    tmp.write_text(json.dumps(new, indent=2) + "\n")
    os.replace(tmp, args.settings)  # atomic: Claude Code never sees a half-written file
    print(f"{'removed from' if args.uninstall else 'installed in'} {args.settings}")


if __name__ == "__main__":
    main()
