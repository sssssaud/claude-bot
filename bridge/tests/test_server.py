"""Bridge HTTP + WebSocket: security, validation, commands (mock hardware)."""
import pytest

from bridge import controls as controls_mod
from bridge.server import BridgeApp


@pytest.fixture
async def cli(aiohttp_client):
    return await aiohttp_client(BridgeApp(mock=True).app)


async def test_health_and_telemetry(cli):
    resp = await cli.get("/health")
    assert resp.status == 200
    data = await resp.json()
    assert data["status"] == "ok" and data["mock"] is True and "bridge_cpu_percent" in data
    data = await (await cli.get("/telemetry")).json()
    assert data["gpu"]["status"] == "asleep"


async def test_origin_and_host_rules(cli):
    for ok in (None, "http://127.0.0.1:5173", "http://localhost:3000"):
        headers = {"Origin": ok} if ok else {}
        assert (await cli.get("/health", headers=headers)).status == 200, ok
    # web pages, sandboxed iframes ("null"), file pages and other apps' schemes are refused
    for bad in ("https://evil.example", "null", "file://", "app://x", "http://127.0.0.1.evil.example"):
        assert (await cli.post("/masti", headers={"Origin": bad})).status == 403, bad
    # DNS rebinding: a foreign Host header is refused even with no Origin
    assert (await cli.get("/health", headers={"Host": "evil.example:8765"})).status == 403


async def test_controls_validate_input(cli):
    assert (await cli.post("/controls/bluetooth", json={"enabled": False})).status == 200
    assert (await (await cli.get("/controls")).json())["bluetooth"] is False
    # "false" as a string used to switch Bluetooth ON (bool("false") is True)
    for bad in ({"enabled": "false"}, {"enabled": 0}, {}):
        assert (await cli.post("/controls/bluetooth", json=bad)).status == 400, bad
    assert (await cli.post("/controls/brightness", json={"percent": 80})).status == 200
    for bad in ({"percent": 0}, {"percent": 101}, {"percent": "50"}, {"percent": None}):
        assert (await cli.post("/controls/brightness", json=bad)).status == 400, bad
    assert (await cli.post("/controls/wifi", data="not json")).status == 400


async def test_commands_are_broadcast_and_validated(cli):
    ws = await cli.ws_connect("/ws")
    init = await ws.receive_json()
    assert init["type"] == "init" and "telemetry" in init and "controls" in init
    assert (await cli.post("/masti")).status == 200
    assert (await cli.post("/pressure", json={"pressure": 62})).status == 200
    got = []
    while len(got) < 2:
        msg = await ws.receive_json(timeout=2)
        if msg["type"] == "cmd":
            got.append(msg)
    assert got == [{"type": "cmd", "cmd": "masti"}, {"type": "cmd", "cmd": "pressure", "value": 62.0}]
    # NaN used to become pressure 100; non-finite, out of range and wrong types are refused
    for bad in ('{"pressure": NaN}', '{"pressure": Infinity}', '{"pressure": 101}', '{"pressure": "nan"}'):
        assert (await cli.post("/pressure", data=bad, headers={"Content-Type": "application/json"})).status == 400, bad
    assert (await cli.post("/emote", json={"name": "../../etc/passwd"})).status == 400
    assert (await cli.post("/emote", json={"name": "04_cool", "duration": 9999})).status == 400
    assert (await cli.post("/look", json={"fx": 2, "fy": 0.5})).status == 400
    assert (await cli.post("/look", json={})).status == 200  # clear the look target
    await ws.close()


def test_unreadable_controls_report_none(monkeypatch):
    monkeypatch.setattr(controls_mod, "_run", lambda *a, **k: None)  # tools missing / D-Bus down
    c = controls_mod.SystemControls()
    assert c.get_all() == {"bluetooth": None, "wifi": None, "brightness": None}
    assert c.set_brightness(50) is None
