"""Claude Bot bridge: HTTP + WebSocket on 127.0.0.1:8765.

The bridge owns hardware: telemetry (1 Hz), quick controls (Bluetooth, Wi-Fi, brightness) and,
from Phase 6, Claude Code activity. It does NOT own the mood: Electron's simulator (ui/mood/mood.js)
is the single source of mood state, so commands here (masti, pressure, look, emote) are broadcast
to Electron as {"type": "cmd", ...} messages. (A second mood engine in Python drifted from the JS
one and made the mood flicker; removed 2026-11-23.)

Security: binds 127.0.0.1 only; refuses any Host other than 127.0.0.1/localhost (DNS rebinding) and
any browser Origin other than http(s)://127.0.0.1|localhost (so web pages, sandboxed iframes with
Origin "null", file:// pages can't toggle Wi-Fi). Local programs send no Origin and are allowed.
"""
import argparse
import asyncio
import json
import logging
import math
import re
import time
from pathlib import Path
from urllib.parse import urlparse

import psutil
from aiohttp import web, WSMsgType

from .activity import EVENTS
from .sessions import Sessions
from .controls import SystemControls
from .telemetry import TelemetryCollector

log = logging.getLogger("bridge")
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
EMOTE_NAME = re.compile(r"^\d\d_[a-z_]+$")
CONTROLS_REFRESH_S = 10.0  # pick up changes made outside the bot (KDE tray, Fn keys)
TOOL_NAME = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
AGENT_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
SESSION_ID = AGENT_ID
NOTIFY_KIND = re.compile(r"^[a-z_]{1,40}$")
PROJECT = re.compile(r"^[^/\\\x00-\x1f]{1,40}$")  # a folder name, never a path
DETAIL = re.compile(r"^[^\x00-\x1f]{1,60}$")  # Claude's one-line summary or a file name (the hook drops paths/secrets)
CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.json"
DEFAULT_ATTENTION = {"come_for_permission": True, "come_when_done": True}
DEFAULT_THRESHOLDS = {"cpu_temp_alert": 90, "gpu_temp_alert": 83, "ram_percent_alert": 90,
                      "tokens_warning_percent": 80, "tokens_critical_percent": 95}


def load_config(path: Path = CONFIG_PATH) -> dict:
    """Thresholds from config.json; a missing file or a bad value falls back to the default, loudly."""
    thresholds, attention = dict(DEFAULT_THRESHOLDS), dict(DEFAULT_ATTENTION)
    try:
        cfg = json.loads(path.read_text())
        raw = cfg.get("thresholds", {})
        raw_attention = cfg.get("attention", {})
    except FileNotFoundError:
        return {"thresholds": thresholds, "attention": attention}
    except (json.JSONDecodeError, AttributeError) as e:
        log.error("config.json unreadable (%s): using defaults", e)
        return {"thresholds": thresholds, "attention": attention}
    for key in DEFAULT_ATTENTION:
        if key in raw_attention:
            if isinstance(raw_attention[key], bool):
                attention[key] = raw_attention[key]
            else:
                log.error("config.json: attention.%s must be true or false; using default", key)
    for key in DEFAULT_THRESHOLDS:
        if key in raw:
            try:
                thresholds[key] = number(raw, key, 1, 120)
            except BadRequest as e:
                log.error("config.json: %s; using default %s", e, DEFAULT_THRESHOLDS[key])
    return {"thresholds": thresholds, "attention": attention}


class BadRequest(ValueError):
    """Client sent something invalid; becomes HTTP 400 with this message."""


# ---- input validation (every value from the network goes through one of these) ----
def number(data: dict, key: str, lo: float, hi: float) -> float:
    v = data.get(key)
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not lo <= v <= hi:
        raise BadRequest(f"'{key}' must be a number from {lo} to {hi}")
    return float(v)


def flag(data: dict, key: str) -> bool:
    v = data.get(key)
    if not isinstance(v, bool):
        raise BadRequest(f"'{key}' must be true or false")
    return v


def optional(data: dict, key: str, pattern):
    v = data.get(key)
    if v is None:
        return None
    if not isinstance(v, str) or not pattern.match(v):
        raise BadRequest(f"'{key}' has an unexpected format")
    return v


def emote_name(data: dict) -> str:
    v = data.get("name")
    if not isinstance(v, str) or not EMOTE_NAME.match(v):
        raise BadRequest("'name' must look like '04_cool'")
    return v


async def body(request) -> dict:
    try:
        data = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise BadRequest("body must be JSON")
    if not isinstance(data, dict):
        raise BadRequest("body must be a JSON object")
    return data


@web.middleware
async def local_only(request, handler):
    host = (request.host or "").rsplit(":", 1)[0].strip("[]")
    if host not in LOCAL_HOSTS:
        return web.json_response({"error": "forbidden host"}, status=403)
    origin = request.headers.get("Origin")
    if origin is not None:
        o = urlparse(origin)
        if o.scheme not in ("http", "https") or o.hostname not in LOCAL_HOSTS:
            return web.json_response({"error": "forbidden origin"}, status=403)
    try:
        response = await handler(request)
    except BadRequest as e:
        response = web.json_response({"error": str(e)}, status=400)
    if origin is not None:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


class BridgeApp:
    def __init__(self, mock: bool = False):
        self.mock = mock
        self.start_time = time.time()
        self.process = psutil.Process()
        self.process.cpu_percent()  # first call only starts the measurement

        self.telemetry = TelemetryCollector(mock=mock)
        self.controls = SystemControls(mock=mock)
        self.latest_telemetry = self.telemetry.snapshot()
        self.latest_controls = None  # filled by the first refresh
        self.sessions = Sessions()  # one activity per Claude Code session
        self.latest_usage = None  # Claude Code token usage, from hooks/statusline.py
        self.config = load_config()
        self.ws_clients = set()
        self.tasks = []

        self.app = web.Application(middlewares=[local_only])
        r = self.app.router
        r.add_route("OPTIONS", "/{tail:.*}", lambda _req: web.Response(status=204))
        r.add_get("/health", self.handle_health)
        r.add_get("/telemetry", lambda _req: web.json_response(self.latest_telemetry))
        r.add_get("/controls", self.handle_get_controls)
        r.add_post("/controls/bluetooth", self.handle_set_bluetooth)
        r.add_post("/controls/wifi", self.handle_set_wifi)
        r.add_post("/controls/brightness", self.handle_set_brightness)
        r.add_post("/masti", self.handle_masti)  # for a KDE custom shortcut (curl -X POST …/masti)
        r.add_post("/pressure", self.handle_pressure)
        r.add_post("/look", self.handle_look)
        r.add_post("/emote", self.handle_emote)
        r.add_post("/event", self.handle_event)  # hooks/claude_hook.py
        r.add_post("/usage", self.handle_usage)  # hooks/statusline.py
        r.add_get("/ws", self.handle_ws)
        self.app.on_startup.append(self._start)
        self.app.on_cleanup.append(self._stop)

    # ---- controls (subprocess calls run in a thread: they can take seconds) ----
    async def refresh_controls(self) -> dict:
        controls = await asyncio.to_thread(self.controls.get_all)
        if controls != self.latest_controls:
            self.latest_controls = controls
            await self.broadcast({"type": "controls", "data": controls})
        return controls

    async def handle_get_controls(self, _request):
        return web.json_response(await self.refresh_controls())

    async def handle_set_bluetooth(self, request):
        enabled = flag(await body(request), "enabled")
        await asyncio.to_thread(self.controls.set_bluetooth, enabled)
        return web.json_response(await self.refresh_controls())

    async def handle_set_wifi(self, request):
        enabled = flag(await body(request), "enabled")
        await asyncio.to_thread(self.controls.set_wifi, enabled)
        return web.json_response(await self.refresh_controls())

    async def handle_set_brightness(self, request):
        percent = number(await body(request), "percent", 5, 100)  # never 0: that can black out the panel
        await asyncio.to_thread(self.controls.set_brightness, round(percent))
        return web.json_response(await self.refresh_controls())

    # ---- commands for Electron's mood engine ----
    async def command(self, cmd: dict):
        await self.broadcast({"type": "cmd", **cmd})
        return web.json_response({"ok": True, "delivered_to": len(self.ws_clients)})

    async def handle_masti(self, _request):
        return await self.command({"cmd": "masti"})

    async def handle_pressure(self, request):
        return await self.command({"cmd": "pressure", "value": number(await body(request), "pressure", 0, 100)})

    async def handle_look(self, request):
        data = await body(request)
        if data.get("fx") is None and data.get("fy") is None:
            return await self.command({"cmd": "look", "look": None})
        return await self.command({"cmd": "look", "look": {"fx": number(data, "fx", 0, 1), "fy": number(data, "fy", 0, 1)}})

    async def handle_emote(self, request):
        data = await body(request)
        return await self.command({"cmd": "emote", "name": emote_name(data), "duration": number(data, "duration", 0.5, 30) if "duration" in data else 6.0})

    # ---- Claude Code ----
    async def handle_event(self, request):
        data = await body(request)
        if data.get("event") not in EVENTS:
            raise BadRequest("unknown 'event'")
        ev = {"event": data["event"], "tool": optional(data, "tool", TOOL_NAME), "agent": optional(data, "agent", AGENT_ID),
              "session": optional(data, "session", SESSION_ID), "project": optional(data, "project", PROJECT),
              "kind": optional(data, "kind", NOTIFY_KIND), "detail": optional(data, "detail", DETAIL)}
        if "pids" in data:  # the session's process ancestors: the app finds its terminal window among them
            pids = data["pids"]
            if not (isinstance(pids, list) and 1 <= len(pids) <= 8
                    and all(isinstance(p, int) and not isinstance(p, bool) and 2 <= p <= 4_194_304 for p in pids)):
                raise BadRequest("'pids' must be 1-8 process ids")
            ev["pids"] = pids
        for key in ("interrupt", "risky"):
            if key in data:
                ev[key] = flag(data, key)
        session, reaction = self.sessions.feed(ev, time.monotonic())
        if reaction:
            await self.broadcast({"type": "cmd", "cmd": "react", "session": session, **reaction})
        return web.json_response({"ok": True})

    async def handle_usage(self, request):
        data = await body(request)
        usage = {}
        for key in ("five_hour", "seven_day"):
            if key in data:
                w = data[key]
                if not isinstance(w, dict):
                    raise BadRequest(f"'{key}' must be an object")
                resets = w.get("resets_at")
                if resets is not None and (isinstance(resets, bool) or not isinstance(resets, int) or resets < 0):
                    raise BadRequest(f"'{key}.resets_at' must be unix seconds")
                usage[key] = {"used_percentage": number(w, "used_percentage", 0, 1000), "resets_at": resets}
        if "context" in data:
            usage["context"] = number(data, "context", 0, 100)
        if not usage:
            raise BadRequest("nothing to record")
        usage["received_at"] = round(time.time())
        self.latest_usage = usage
        await self.broadcast({"type": "usage", "data": usage})
        return web.json_response({"ok": True})

    async def handle_health(self, _request):
        return web.json_response({
            "status": "ok",
            "uptime_seconds": round(time.time() - self.start_time, 1),
            "bridge_cpu_percent": round(self.process.cpu_percent(), 2),
            "ws_clients": len(self.ws_clients),
            "mock": self.mock,
        })

    async def handle_ws(self, request):
        ws = web.WebSocketResponse(heartbeat=30)
        await ws.prepare(request)
        self.ws_clients.add(ws)
        try:
            await ws.send_json({"type": "init", "telemetry": self.latest_telemetry, "controls": self.latest_controls,
                                "usage": self.latest_usage, "config": self.config})
            async for msg in ws:  # clients only listen; anything they send is ignored
                if msg.type == WSMsgType.ERROR:
                    log.warning("websocket closed with error: %s", ws.exception())
        finally:
            self.ws_clients.discard(ws)
        return ws

    async def broadcast(self, message: dict):
        payload = json.dumps(message)
        for ws in list(self.ws_clients):
            try:
                await ws.send_str(payload)
            except (ConnectionError, RuntimeError) as e:
                log.info("dropping a websocket client: %s", e)
                self.ws_clients.discard(ws)

    # ---- background loops ----
    async def _telemetry_loop(self):
        while True:
            await asyncio.sleep(1.0)
            try:
                t = self.latest_telemetry = await asyncio.to_thread(self.telemetry.snapshot)
                await self.broadcast({"type": "telemetry", "data": t})
                gpu = t["gpu"]["usage"] if t["gpu"].get("awake") else 0
                load = max(t["cpu"].get("usage") or 0, gpu or 0)
                await self.broadcast({"type": "live", "sessions": self.sessions.live(time.monotonic(), load), "load": load})
            except Exception:  # keep the loop alive, but never silently
                log.exception("telemetry snapshot failed")

    async def _controls_loop(self):
        while True:
            try:
                await self.refresh_controls()
            except Exception:
                log.exception("controls refresh failed")
            await asyncio.sleep(CONTROLS_REFRESH_S)

    async def _start(self, _app):
        self.tasks = [asyncio.create_task(self._telemetry_loop()), asyncio.create_task(self._controls_loop())]

    async def _stop(self, _app):
        for t in self.tasks:
            t.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        for ws in list(self.ws_clients):
            await ws.close()
        self.ws_clients.clear()


def main():
    parser = argparse.ArgumentParser(description="Claude Bot bridge")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--mock", action="store_true", help="fake telemetry and controls")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    web.run_app(BridgeApp(mock=args.mock).app, host="127.0.0.1", port=args.port, print=None)


if __name__ == "__main__":
    main()
