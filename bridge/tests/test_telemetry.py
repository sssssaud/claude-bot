"""Unit tests for bridge telemetry collection and dGPU sleep safety."""
import os
import tempfile
import pytest
from bridge.telemetry import TelemetryCollector

def test_mock_telemetry():
    collector = TelemetryCollector(mock=True)
    snap = collector.snapshot()
    assert "cpu" in snap
    assert "gpu" in snap
    assert "ram" in snap
    assert "battery" in snap
    assert "fans" in snap
    assert snap["gpu"]["status"] == "asleep"
    assert snap["cpu"]["usage"] == 24.0

def test_dgpu_sleep_safety_when_suspended():
    """Ensure that if sysfs runtime_status is 'suspended', NVML is NOT touched."""
    with tempfile.NamedTemporaryFile("w+", delete=False) as f:
        f.write("suspended\n")
        f.flush()
        temp_path = f.name

    try:
        collector = TelemetryCollector(pci_status_path=temp_path, mock=False)
        gpu = collector.get_dgpu()
        assert gpu["available"] is True
        assert gpu["awake"] is False
        assert gpu["status"] == "asleep"
        assert gpu["temp"] is None
        assert gpu["usage"] == 0
    finally:
        os.remove(temp_path)

def test_dgpu_when_path_missing():
    collector = TelemetryCollector(pci_status_path="/tmp/nonexistent_pci_status_file_test", mock=False)
    gpu = collector.get_dgpu()
    assert gpu["available"] is False
    assert gpu["awake"] is False
    assert gpu["status"] == "not_found"

def test_cpu_smoothing():
    collector = TelemetryCollector(mock=False)
    # Consecutive calls should not crash and return smoothed numbers
    cpu1 = collector.get_cpu()
    cpu2 = collector.get_cpu()
    assert isinstance(cpu1["usage"], float)
    assert isinstance(cpu2["usage"], float)


def test_battery_is_real_or_none_never_made_up(monkeypatch):
    from collections import namedtuple
    from bridge import telemetry
    Bat = namedtuple("Bat", "percent secsleft power_plugged")
    c = TelemetryCollector(mock=True)
    c.mock = False  # the battery path only; no sysfs discovery needed
    monkeypatch.setattr(telemetry.psutil, "sensors_battery", lambda: Bat(14.96, 900, False))
    assert c.get_battery() == {"percent": 15.0, "plugged": False}
    monkeypatch.setattr(telemetry.psutil, "sensors_battery", lambda: Bat(80, 900, None))
    assert c.get_battery() == {"percent": 80, "plugged": None}, "unknown stays unknown, not 'unplugged'"
    monkeypatch.setattr(telemetry.psutil, "sensors_battery", lambda: None)
    assert c.get_battery() is None, "no battery (desktop): no reading, not 100 % plugged"

    def broken():
        raise OSError("sysfs hiccup")
    monkeypatch.setattr(telemetry.psutil, "sensors_battery", broken)
    assert c.get_battery() is None and c._battery_warned
