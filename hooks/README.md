# Claude Code → claude-bot

Two scripts connect Claude Code to the bridge (`./run.sh` or `npm run bridge` starts it):

| Script | Claude Code runs it as | Sends to the bridge |
|---|---|---|
| `claude_hook.py` | a hook on 10 events (incl. SessionStart/SessionEnd) | event name, tool name, yes/no flags (`interrupt`, `risky`), sub-agent id, session id and the project folder's **name** (one octo per session). Never prompts, commands, full paths or messages: a Bash command is checked for risky patterns locally and only the yes/no leaves. |
| `statusline.py` | the status line, wrapping the one you had | 5-hour and weekly `used_percentage` + `resets_at`, context-window %. Your old status line still runs and prints exactly as before. |

Both use only the standard library, print nothing to stdout, give up after 0.3 s and always exit 0,
so a stopped bridge never slows or breaks Claude Code (measured: 37 ms per hook call).

```bash
python3 hooks/install.py --dry-run     # see the change, write nothing
python3 hooks/install.py               # back up ~/.claude/settings.json, then add hooks + wrapper
python3 hooks/install.py --uninstall   # remove exactly what was added
```
Existing hooks (Mission Control's) and the existing status line (ponytail's) are kept. Restart Claude Code
sessions after installing. Token numbers update whenever Claude Code redraws its status line (only while a
session is open, subscription logins only).
