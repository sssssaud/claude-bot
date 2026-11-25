"""Claude Code sessions: one Activity per running session, plus what each one is doing. Pure (no I/O).

Saud's purpose for the bot (2026-11-23): one octo per session, so terminals can stay minimised and the
octos show where what is happening. A session is known by its session_id and labelled with its project
folder's name (never the full path).
"""
from typing import Optional, Tuple

from . import feelings
from .activity import Activity

MAX_SESSIONS = 6  # more octos than this would bury the screen; the least recently active one goes
DONE_S = 8.0  # a finished turn calls the octo over for this long
# Attention (Saud 2026-11-23): the octo comes to the cursor when its session needs a permission, and
# when a turn is done. A permission episode ends with the session's next action (answered either way).
STALE_S = 30 * 60  # no event for 30 min: the session crashed or was closed without SessionEnd
# Session moments (Saud's pick, 2026-11-25): situations, not single events. The app shows them; how is the
# personality's business. Order = priority.
WAIT_LONG_S = 60  # a permission unanswered this long: "waiting_long"
CONTEXT_FULL = 85  # % of the session's context window: "context_full"
LONG_TURN_S = 10 * 60  # Claude's own working time on one prompt (time waiting for Saud doesn't count): "long_turn"
JUGGLING = 2  # sub-agents running at once: "juggling"
LIMIT_NEAR = 80  # % of the 5-hour or weekly token limit: "limit_near"
TOOL_DOING = {"Edit": "Editing", "Write": "Editing", "MultiEdit": "Editing", "NotebookEdit": "Editing",
              "Bash": "Running a command", "Read": "Reading code", "Grep": "Reading code", "Glob": "Reading code",
              "WebSearch": "Searching the web", "WebFetch": "Searching the web",
              "Agent": "Starting a sub-agent", "Task": "Starting a sub-agent", "Skill": "Using a skill"}
# with the hook's detail (Claude's summary / a file name; Saud's option 2): the app shows it when "Show details" is on
DETAIL_DOING = {"Bash": "{}", "Agent": "Agent: {}", "Task": "Agent: {}", "Read": "Reading {}",
                "Edit": "Editing {}", "Write": "Editing {}", "MultiEdit": "Editing {}", "NotebookEdit": "Editing {}"}


def detail_for(ev: dict) -> Optional[str]:
    """The same moment in Claude's words ("Run all tests", "Editing main.js"); None = only the generic label."""
    form = DETAIL_DOING.get(ev.get("tool") or "")
    if not ev.get("detail") or not form:
        return None
    if ev["event"] == "PermissionRequest":
        return "Needs you: " + form.format(ev["detail"])
    return form.format(ev["detail"]) if ev["event"] == "PreToolUse" else None


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
                                   "attention": None, "attention_at": 0.0, "attention_id": 0,
                                   "turn_at": None, "waited": 0.0, "context": None, "feel": feelings.Feelings(now)}
        s["seen"] = now
        if ev.get("project"):
            s["project"] = ev["project"]
        if ev.get("pids"):
            s["pids"] = ev["pids"]
        doing = doing_for(ev)
        # the notification that echoes a permission request carries no tool: keep the request's own words
        echo = ev["event"] == "Notification" and ev.get("kind") == "permission_prompt" and s["attention"] == "permission"
        if doing and not echo:
            s["doing"], s["detail"] = doing, detail_for(ev)
        self._attend(s, ev, now)
        worked = self._worked(s, now)
        if ev["event"] == "UserPromptSubmit":
            s["turn_at"], s["waited"] = now, 0.0  # a new turn: its working time starts now
        elif ev["event"] == "Stop":
            s["turn_at"] = None
        elif s["turn_at"] is None and ev["event"] in ("PreToolUse", "PostToolUse", "PostToolUseFailure"):
            s["turn_at"], s["waited"] = now, 0.0  # tools running, start unseen (bridge restarted mid-turn): working
        reaction = s["activity"].feed(ev, now)
        self._feel(s, ev, reaction, worked, now)
        return sid, reaction

    @staticmethod
    def _worked(s: dict, now: float) -> float:
        """Claude's own working time on the current prompt: time waiting for Saud doesn't count."""
        if s["turn_at"] is None:
            return 0.0
        waiting = now - s["attention_at"] if s["attention"] == "permission" else 0.0
        return now - s["turn_at"] - s["waited"] - waiting

    @staticmethod
    def _feel(s: dict, ev: dict, reaction: Optional[dict], worked: float, now: float):
        """The one-off nudges to the octo's feelings (bridge/feelings.py)."""
        feel, kind = s["feel"], ev["event"]
        if kind == "PostToolUseFailure" and not ev.get("interrupt"):
            n = s["activity"].failures
            if n >= 3:
                feel.nudge(now, f"{n} errors in a row", happiness=feelings.ERRORS_IN_A_ROW)
            else:
                feel.nudge(now, "an error", happiness=feelings.ERROR)
        elif reaction and reaction.get("emote") == "22_healing":
            feel.nudge(now, "fixed it after errors", happiness=feelings.FIXED)
        elif kind == "Stop":
            if worked >= LONG_TURN_S:
                feel.nudge(now, "finished a long task", happiness=feelings.DONE, energy=feelings.LONG_TASK)
            else:
                feel.nudge(now, "finished a task", happiness=feelings.DONE)

    def set_context(self, sid: str, percent: float):
        """How full this session's context window is (from its status line). Unknown sessions: ignored."""
        if sid in self.by_id:
            self.by_id[sid]["context"] = percent

    @staticmethod
    def _moments(s: dict, now: float, limit_pct: Optional[float]) -> list:
        waiting = s["attention"] == "permission"
        out = []
        if waiting and now - s["attention_at"] >= WAIT_LONG_S:
            out.append("waiting_long")
        if (s["context"] or 0) >= CONTEXT_FULL:
            out.append("context_full")
        if Sessions._worked(s, now) >= LONG_TURN_S:
            out.append("long_turn")
        if len(s["activity"].subagents) >= JUGGLING:
            out.append("juggling")
        if limit_pct is not None and limit_pct >= LIMIT_NEAR:
            out.append("limit_near")
        return out

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
        if s["attention"] == "permission" and (want != "permission" or kind == "PermissionRequest"):
            s["waited"] += now - s["attention_at"]  # time spent waiting for Saud isn't Claude working
        # a new episode (the octo comes over again): a new kind, or another permission request (a new
        # question, even if the last one was dismissed); the notification that echoes a request is not
        if (want and want != s["attention"]) or kind == "PermissionRequest":
            s["attention_id"] += 1
            s["attention_at"] = now
        s["attention"] = want  # any real activity ends the episode: answered, or a new prompt after "done"

    def live(self, now: float, system_load: float = 0.0, limit_pct: Optional[float] = None, hour: int = 12) -> list:
        """Every live session, oldest first: id, label, pressure, doing, moments, feel. Drops stale ones.
        limit_pct: the higher of the 5-hour and weekly token limits used (None = unknown); hour: local, 0–23."""
        for sid in [k for k, s in self.by_id.items() if now - s["seen"] > STALE_S]:
            del self.by_id[sid]
        out, seen_labels = [], {}
        for sid, s in sorted(self.by_id.items(), key=lambda kv: kv[1]["since"]):
            n = seen_labels[s["project"]] = seen_labels.get(s["project"], 0) + 1
            label = s["project"] if n == 1 else f"{s['project']} #{n}"  # two sessions in one folder
            if s["attention"] == "done" and now - s["attention_at"] > DONE_S:
                s["attention"] = None
            pressure = s["activity"].pressure(now, system_load)
            moments = self._moments(s, now, limit_pct)
            s["feel"].tick(now, pressure, s["turn_at"] is not None, "waiting_long" in moments, hour)
            out.append({"id": sid, "project": label, "doing": s["doing"], "detail": s.get("detail"),
                        "pressure": round(pressure, 1),
                        "attention": s["attention"], "attention_id": s["attention_id"], "pids": s.get("pids", []),
                        "moments": moments, "feel": s["feel"].snapshot()})
        return out
