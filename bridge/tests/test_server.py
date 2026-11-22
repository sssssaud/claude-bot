"""Unit tests for Bridge HTTP & WebSocket server, including origin checks."""
import pytest
from aiohttp import web
from bridge.server import BridgeApp

@pytest.fixture
async def cli(aiohttp_client):
    bridge = BridgeApp(mock=True)
    client = await aiohttp_client(bridge.app)
    return client

async def test_health_endpoint(cli):
    resp = await cli.get("/health")
    assert resp.status == 200
    data = await resp.json()
    assert data["status"] == "ok"
    assert data["mock"] is True
    assert "uptime_seconds" in data
    assert "bridge_cpu_percent" in data

async def test_telemetry_endpoint(cli):
    resp = await cli.get("/telemetry")
    assert resp.status == 200
    data = await resp.json()
    assert "cpu" in data
    assert "gpu" in data
    assert data["gpu"]["status"] == "asleep"

async def test_controls_endpoints(cli):
    resp = await cli.get("/controls")
    assert resp.status == 200
    data = await resp.json()
    assert "bluetooth" in data
    assert "wifi" in data
    assert "brightness" in data

    # Toggle Bluetooth
    resp = await cli.post("/controls/bluetooth", json={"enabled": False})
    assert resp.status == 200
    data = await resp.json()
    assert data["bluetooth"] is False

    # Set Brightness
    resp = await cli.post("/controls/brightness", json={"percent": 80})
    assert resp.status == 200
    data = await resp.json()
    assert data["percent"] == 80

async def test_masti_toggle(cli):
    resp = await cli.post("/masti")
    assert resp.status == 200
    data = await resp.json()
    assert data["masti"] is True

    resp = await cli.post("/masti")
    assert resp.status == 200
    data = await resp.json()
    assert data["masti"] is False

async def test_origin_security(cli):
    # Allowed local origin
    resp = await cli.get("/health", headers={"Origin": "http://127.0.0.1:5173"})
    assert resp.status == 200

    # Allowed localhost
    resp = await cli.get("/health", headers={"Origin": "http://localhost:3000"})
    assert resp.status == 200

    # Rejected non-local origin
    resp = await cli.get("/health", headers={"Origin": "https://evil-site.com"})
    assert resp.status == 403

async def test_websocket_stream(cli):
    ws = await cli.ws_connect("/ws")
    msg = await ws.receive_json()
    assert msg["type"] == "init"
    assert "state" in msg
    assert "telemetry" in msg
    assert "controls" in msg
    await ws.close()
