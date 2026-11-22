"""Claude Bot Python Bridge HTTP and WebSocket Server.

Runs on 127.0.0.1:8765. Rejects non-local origins.
Streams companion state @ 10 Hz and hardware telemetry @ 1 Hz over WebSocket.
"""
import argparse
import asyncio
import json
import os
import psutil
import time
from urllib.parse import urlparse
from aiohttp import web, WSMsgType

from .telemetry import TelemetryCollector
from .controls import SystemControls
from .state import StateManager

ALLOWED_HOSTS = {"127.0.0.1", "localhost", "::1"}

@web.middleware
async def origin_check_middleware(request, handler):
    origin = request.headers.get("Origin")
    if origin and origin != "null":
        try:
            parsed = urlparse(origin)
            # Allow file:// or electron/vscode schemas or local hostnames
            if parsed.scheme not in ("file", "vscode-webview", "app") and parsed.hostname not in ALLOWED_HOSTS:
                return web.Response(status=403, text="Forbidden: Non-local origin")
        except Exception:
            return web.Response(status=403, text="Forbidden: Invalid origin")
    
    response = await handler(request)
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

class BridgeApp:
    def __init__(self, mock: bool = False):
        self.mock = mock
        self.start_time = time.time()
        self.process = psutil.Process()
        # Warm up process cpu measurement
        self.process.cpu_percent()
        
        self.telemetry = TelemetryCollector(mock=mock)
        self.controls = SystemControls(mock=mock)
        self.state_mgr = StateManager(start_time=self.start_time)
        
        self.latest_telemetry = self.telemetry.snapshot()
        self.ws_clients = set()
        
        self.telemetry_task = None
        self.state_task = None
        self.app = web.Application(middlewares=[origin_check_middleware])
        self._setup_routes()
        self.app.on_startup.append(self._start_background_tasks)
        self.app.on_cleanup.append(self._cleanup_background_tasks)

    def _setup_routes(self):
        self.app.router.add_options("/{tail:.*}", self.handle_options)
        self.app.router.add_get("/health", self.handle_health)
        self.app.router.add_get("/telemetry", self.handle_telemetry)
        self.app.router.add_get("/controls", self.handle_get_controls)
        self.app.router.add_post("/controls/bluetooth", self.handle_set_bluetooth)
        self.app.router.add_post("/controls/wifi", self.handle_set_wifi)
        self.app.router.add_post("/controls/brightness", self.handle_set_brightness)
        self.app.router.add_post("/masti", self.handle_masti)
        self.app.router.add_post("/pressure", self.handle_pressure)
        self.app.router.add_post("/look", self.handle_look)
        self.app.router.add_post("/emote", self.handle_emote)
        self.app.router.add_get("/ws", self.handle_ws)

    async def handle_options(self, request):
        return web.Response(status=204)

    async def handle_health(self, request):
        cpu_pct = round(self.process.cpu_percent(), 2)
        return web.json_response({
            "status": "ok",
            "uptime_seconds": round(time.time() - self.start_time, 1),
            "bridge_cpu_percent": cpu_pct,
            "ws_clients": len(self.ws_clients),
            "mock": self.mock,
        })

    async def handle_telemetry(self, request):
        return web.json_response(self.latest_telemetry)

    async def handle_get_controls(self, request):
        return web.json_response(self.controls.get_all())

    async def handle_set_bluetooth(self, request):
        try:
            data = await request.json()
            enabled = bool(data.get("enabled", True))
            new_status = self.controls.set_bluetooth(enabled)
            await self.broadcast({"type": "controls", "data": self.controls.get_all()})
            return web.json_response({"bluetooth": new_status})
        except Exception as e:
            return web.Response(status=400, text=str(e))

    async def handle_set_wifi(self, request):
        try:
            data = await request.json()
            enabled = bool(data.get("enabled", True))
            new_status = self.controls.set_wifi(enabled)
            await self.broadcast({"type": "controls", "data": self.controls.get_all()})
            return web.json_response({"wifi": new_status})
        except Exception as e:
            return web.Response(status=400, text=str(e))

    async def handle_set_brightness(self, request):
        try:
            data = await request.json()
            percent = int(data.get("percent", 50))
            new_info = self.controls.set_brightness(percent)
            await self.broadcast({"type": "controls", "data": self.controls.get_all()})
            return web.json_response(new_info)
        except Exception as e:
            return web.Response(status=400, text=str(e))

    async def handle_masti(self, request):
        now = time.time()
        is_masti = self.state_mgr.toggle_masti(now)
        state = self.state_mgr.state(now)
        await self.broadcast({"type": "state", "data": state})
        return web.json_response({"masti": is_masti})

    async def handle_pressure(self, request):
        try:
            data = await request.json()
            p = float(data.get("pressure", 0))
            now = time.time()
            self.state_mgr.set_pressure(p, now)
            state = self.state_mgr.state(now)
            await self.broadcast({"type": "state", "data": state})
            return web.json_response({"pressure": state["p"]})
        except Exception as e:
            return web.Response(status=400, text=str(e))

    async def handle_look(self, request):
        try:
            data = await request.json()
            fx = data.get("fx")
            fy = data.get("fy")
            self.state_mgr.set_look(fx, fy)
            state = self.state_mgr.state()
            await self.broadcast({"type": "state", "data": state})
            return web.json_response({"look": state["look"]})
        except Exception as e:
            return web.Response(status=400, text=str(e))

    async def handle_emote(self, request):
        try:
            data = await request.json()
            name = str(data.get("name"))
            dur = float(data.get("duration", 6.0))
            now = time.time()
            self.state_mgr.set_emote(name, dur, now)
            state = self.state_mgr.state(now)
            await self.broadcast({"type": "state", "data": state})
            return web.json_response({"emote": name})
        except Exception as e:
            return web.Response(status=400, text=str(e))

    async def handle_ws(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.ws_clients.add(ws)

        # Initial burst
        await ws.send_json({
            "type": "init",
            "state": self.state_mgr.state(),
            "telemetry": self.latest_telemetry,
            "controls": self.controls.get_all(),
        })

        try:
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    try:
                        payload = json.loads(msg.data)
                        cmd = payload.get("cmd")
                        if cmd == "pressure":
                            self.state_mgr.set_pressure(payload.get("value", 0))
                        elif cmd == "masti":
                            self.state_mgr.toggle_masti()
                        elif cmd == "look":
                            self.state_mgr.set_look(payload.get("fx"), payload.get("fy"))
                        elif cmd == "emote":
                            self.state_mgr.set_emote(payload.get("name"), payload.get("duration", 6.0))
                        elif cmd == "get_telemetry":
                            await ws.send_json({"type": "telemetry", "data": self.latest_telemetry})
                    except Exception:
                        pass
                elif msg.type == WSMsgType.ERROR:
                    break
        finally:
            self.ws_clients.discard(ws)

        return ws

    async def broadcast(self, message: dict):
        if not self.ws_clients:
            return
        payload = json.dumps(message)
        dead = []
        for ws in self.ws_clients:
            try:
                await ws.send_str(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.ws_clients.discard(ws)

    async def _telemetry_loop(self):
        while True:
            try:
                await asyncio.sleep(1.0)
                snapshot = self.telemetry.snapshot()
                self.latest_telemetry = snapshot
                
                # Update temps for mood engine
                cpu_t = snapshot.get("cpu", {}).get("temp")
                gpu_t = snapshot.get("gpu", {}).get("temp")
                self.state_mgr.update_telemetry_temps(cpu_t, gpu_t)
                
                if self.ws_clients:
                    await self.broadcast({"type": "telemetry", "data": snapshot})
            except asyncio.CancelledError:
                break
            except Exception as e:
                await asyncio.sleep(1.0)

    async def _state_loop(self):
        while True:
            try:
                await asyncio.sleep(0.1)  # 10 Hz
                if self.ws_clients:
                    state = self.state_mgr.state()
                    await self.broadcast({"type": "state", "data": state})
            except asyncio.CancelledError:
                break
            except Exception as e:
                await asyncio.sleep(0.1)

    async def _start_background_tasks(self, app):
        self.telemetry_task = asyncio.create_task(self._telemetry_loop())
        self.state_task = asyncio.create_task(self._state_loop())

    async def _cleanup_background_tasks(self, app):
        if self.telemetry_task:
            self.telemetry_task.cancel()
        if self.state_task:
            self.state_task.cancel()
        tasks = [t for t in (self.telemetry_task, self.state_task) if t]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        for ws in list(self.ws_clients):
            await ws.close()
        self.ws_clients.clear()

def main():
    parser = argparse.ArgumentParser(description="Claude Bot Python Bridge")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="Port to bind to (default 8765)")
    parser.add_argument("--mock", action="store_true", help="Use mock telemetry and controls")
    args = parser.parse_args()

    bridge = BridgeApp(mock=args.mock)
    web.run_app(bridge.app, host=args.host, port=args.port)

if __name__ == "__main__":
    main()
