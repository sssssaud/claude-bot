"""hooks/install.py: keeps existing hooks and status line, idempotent, uninstall restores exactly."""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

HOOKS = Path(__file__).resolve().parents[2] / "hooks"
spec = importlib.util.spec_from_file_location("install", HOOKS / "install.py")
inst = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inst)

# the shape of Saud's real settings.json (2026-11-23), other keys trimmed
MC = "python3 /home/saud/Desktop/Projects/mission-control/mc_hook.py stop 2>/dev/null || true"
PONYTAIL = 'bash "/home/saud/.claude/plugins/sources/ponytail/hooks/ponytail-statusline.sh"'
REAL = {"model": "opus", "env": {"X": "1"},
        "statusLine": {"type": "command", "command": PONYTAIL},
        "hooks": {"Stop": [{"hooks": [{"type": "command", "command": MC}]}],
                  "SessionStart": [{"hooks": [{"type": "command", "command": MC.replace("stop", "start")}]}]}}


def test_install_keeps_everything_and_wraps_the_status_line():
    s = inst.install(REAL)
    assert s["model"] == "opus" and s["env"] == {"X": "1"}
    assert s["hooks"]["Stop"][0]["hooks"][0]["command"] == MC, "Mission Control's hook untouched"
    assert s["hooks"]["SessionStart"] == REAL["hooks"]["SessionStart"]
    for ev in inst.TOOL_EVENTS + inst.OTHER_EVENTS:
        assert sum(inst.is_ours(h) for g in s["hooks"][ev] for h in g["hooks"]) == 1, ev
    assert s["hooks"]["PreToolUse"][0]["matcher"] == "*"
    assert inst.unwrap(s["statusLine"]["command"]) == PONYTAIL, "ponytail still runs inside the wrapper"
    assert REAL["hooks"]["Stop"] == [{"hooks": [{"type": "command", "command": MC}]}], "input not mutated"


def test_install_twice_changes_nothing_and_uninstall_restores_exactly():
    once = inst.install(REAL)
    assert inst.install(once) == once
    assert inst.uninstall(once) == REAL
    assert inst.uninstall(REAL) == REAL


def test_wrapped_status_line_really_runs_the_original(tmp_path):
    """Run the wrapper command through a shell like Claude Code does, with a path containing a space."""
    script = tmp_path / "my status.sh"
    script.write_text('read x; echo "orig:$x"')
    original = f'bash "{script}"'
    cmd = inst.wrapped(original)
    out = subprocess.run(["sh", "-c", cmd], input="hello\n", capture_output=True, text=True, timeout=10).stdout
    assert out == "orig:hello\n"


def test_cli_dry_run_writes_nothing_and_real_run_backs_up(tmp_path):
    f = tmp_path / "settings.json"
    f.write_text(json.dumps(REAL))
    run = lambda *a: subprocess.run([sys.executable, "-I", str(HOOKS / "install.py"), "--settings", str(f), *a],
                                    capture_output=True, text=True, timeout=10)
    assert "dry run" in run("--dry-run").stdout and json.loads(f.read_text()) == REAL
    assert run().returncode == 0
    assert len(list(tmp_path.glob("settings.json.bak-claude-bot-*"))) == 1
    assert "nothing to change" in run().stdout
    run("--uninstall")
    assert json.loads(f.read_text()) == REAL
