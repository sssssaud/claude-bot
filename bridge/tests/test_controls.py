"""Unit tests for quick system controls."""
from bridge.controls import SystemControls

def test_mock_controls():
    ctrl = SystemControls(mock=True)
    all_ctrl = ctrl.get_all()
    assert all_ctrl["bluetooth"] is True
    assert all_ctrl["wifi"] is True
    assert all_ctrl["brightness"]["percent"] == 40

    # Test toggles
    assert ctrl.set_bluetooth(False) is False
    assert ctrl.get_bluetooth() is False
    assert ctrl.set_bluetooth(True) is True

    assert ctrl.set_wifi(False) is False
    assert ctrl.get_wifi() is False

    b = ctrl.set_brightness(75)
    assert b["percent"] == 75
    assert ctrl.get_brightness()["percent"] == 75
