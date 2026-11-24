"""Claude Code sessions: one Activity per running session, plus what each one is doing. Pure (no I/O).

Saud's purpose for the bot (2026-11-23): one octo per session, so terminals can stay minimised and the
octos show where what is happening. A session is known by its session_id and labelled with its project
folder's name (never the full path).
"""
from typing import Optional, Tuple

from .activity import Activity

MAX_SESSIONS = 6  # more octos than this would bury the screen; the least recently active one goes
DONE_S = 8.0  # a finished turn calls the octo over for this long
# Attention (Saud 2026-11-23): the octo comes to the cursor when its session needs a permission, and
# when a turn is done. A permission episode ends with the session's next action (answered either way).
STALE_S = 30 * 60  # no event for 30 min: the session crashed or was closed without SessionEnd
TOOL_DOING = {"Edit": "Editing", "Write": "Editing", "MultiEdit": "Editing", "NotebookEdit": "Editing",
              "Bash": "Running a command", "Read": "Reading code", "Grep": "Reading code", "Glob": "Reading code",
              "WebSearch": "Searching the web", "WebFetch": "Searching the web",
              "Agent": "Starting a sub-agent", "Task": "Starting a sub-agent", "Skill": "Using a skill"}


def doing_for(ev: dict) -> Optional[str]:
    """Short, human label for what this event says the session is doing (None = unchanged)."""
    kind = ev["event"]
    if kind == "PreToolUse":
        return TOOL_DOING.get(ev.get("tool") or "", "Working")
    if kind == "PostToolUseFailure":
        return "Stopped" if ev.get("interrupt") else "Hit an error"
    if kind == "PermissionRequest" or (kind == "Notification" and ev.get("kind") == "permission_prompt"):
        return f"Needs permission: {ev['tool']}" if ev.get("tool") else "Needs permission"
    return {"UserPromptSubmit": "Thinking", "PostToolUse": "Thinking", "SubagentStart": "Sub-agents working",
            "Notification": "Needs you", "Stop": "Done", "SessionStart": "Ready"}.get(kind)


class Sessions:
    def __init__(self):
        self.by_id = {}  # id -> {"activity", "project", "doing", "seen", "since"}

    def feed(self, ev: dict, now: float) -> Tuple[str, Optional[dict]]:
        """One validated hook event → (session id, reaction or None)."""
        sid = ev.get("session") or "default"
        if ev["event"] == "SessionEnd":
            self.by_id.pop(sid, None)
            return sid, None
        s = self.by_id.get(sid)
        if s is None:
            if len(self.by_id) >= MAX_SESSIONS:
                oldest = min(self.by_id, key=lambda k: self.by_id[k]["seen"])
                del self.by_id[oldest]
            s = self.by_id[sid] = {"activity": Activity(), "project": "Claude Code", "doing": "Ready", "seen": now, "since": now,
                                   "attention": None, "attention_at": 0.0, "attention_id": 0}
        s["seen"] = now
        if ev.get("project"):
            s["project"] = ev["project"]
        if ev.get("pids"):
            s["pids"] = ev["pids"]
        doing = doing_for(ev)
        if doing:
            s["doing"] = doing
        self._attend(s, ev, now)
        return sid, s["activity"].feed(ev, now)

    @staticmethod
    def _attend(s: dict, ev: dict, now: float):
        kind = ev["event"]
        if kind == "PermissionRequest" or (kind == "Notification" and ev.get("kind") == "permission_prompt"):
            want = "permission"
        elif kind == "Stop":
            want = "done"
        elif kind in ("Notification", "SubagentStart", "SubagentStop"):
            return  # side events: they don't answer a permission
        else:
            want = None  # the session moved on, so a pending permission was answered
        # a new episode (the octo comes over again): a new kind, or another permission request (a new
        # question, even if the last one was dismissed); the notification that echoes a request is not
        if (want and want != s["attention"]) or kind == "PermissionRequest":
            s["attention_id"] += 1
            s["attention_at"] = now
        s["attention"] = want  # any real activity ends the episode: answered, or a new prompt after "done"

    def live(self, now: float, system_load: float = 0.0) -> list:
        """Every live session, oldest first: id, label, pressure, doing. Drops stale ones."""
        for sid in [k for k, s in self.by_id.items() if now - s["seen"] > STALE_S]:
            del self.by_id[sid]
        out, seen_labels = [], {}
        for sid, s in sorted(self.by_id.items(), key=lambda kv: kv[1]["since"]):
            n = seen_labels[s["project"]] = seen_labels.get(s["project"], 0) + 1
            label = s["project"] if n == 1 else f"{s['project']} #{n}"  # two sessions in one folder
            if s["attention"] == "done" and now - s["attention_at"] > DONE_S:
                s["attention"] = None
            out.append({"id": sid, "project": label, "doing": s["doing"],
                        "pressure": round(s["activity"].pressure(now, system_load), 1),
                        "attention": s["attention"], "attention_id": s["attention_id"], "pids": s.get("pids", [])})
        return out
