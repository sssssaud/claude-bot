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
