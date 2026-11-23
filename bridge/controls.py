"""Quick controls for Bluetooth, Wi-Fi, and Screen Brightness on Nobara / KDE Plasma.

Reads return None when the state can't be read (tool missing, D-Bus down), never a made-up value,
so the popup can show "?" instead of lying.
"""
import logging
import subprocess
from typing import Dict, Any, Optional

log = logging.getLogger("bridge.controls")


def _run(cmd: list, timeout: float = 2.0) -> Optional[str]:
    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        log.warning("%s failed: %s", cmd[0], e)
        return None
    if res.returncode != 0:
        log.warning("%s exited %s: %s", " ".join(cmd[:3]), res.returncode, res.stderr.strip()[:200])
        return None
    return res.stdout.strip()

class SystemControls:
    def __init__(self, mock: bool = False):
        self.mock = mock
        self._mock_bt = True
        self._mock_wifi = True
        self._mock_brightness = 40

    def get_bluetooth(self) -> Optional[bool]:
        if self.mock:
            return self._mock_bt
        out = _run(["bluetoothctl", "show"])
        if out:
            for line in out.splitlines():
                if "Powered:" in line:
                    return "yes" in line.lower()
        return None

    def set_bluetooth(self, enabled: bool) -> bool:
        if self.mock:
            self._mock_bt = enabled
            return self._mock_bt
        arg = "on" if enabled else "off"
        _run(["bluetoothctl", "power", arg])
        return self.get_bluetooth()

    def get_wifi(self) -> Optional[bool]:
        if self.mock:
            return self._mock_wifi
        out = _run(["nmcli", "radio", "wifi"])
        if out in ("enabled", "disabled"):
            return out == "enabled"
        return None

    def set_wifi(self, enabled: bool) -> bool:
        if self.mock:
            self._mock_wifi = enabled
            return self._mock_wifi
        arg = "on" if enabled else "off"
        _run(["nmcli", "radio", "wifi", arg])
        return self.get_wifi()

    def get_brightness(self) -> Optional[Dict[str, Any]]:
        if self.mock:
            return {"percent": self._mock_brightness, "current": self._mock_brightness * 100, "max": 10000}
        
        cur_out = _run(["qdbus", "org.kde.Solid.PowerManagement",
                        "/org/kde/Solid/PowerManagement/Actions/BrightnessControl",
                        "org.kde.Solid.PowerManagement.Actions.BrightnessControl.brightness"])
        max_out = _run(["qdbus", "org.kde.Solid.PowerManagement",
                        "/org/kde/Solid/PowerManagement/Actions/BrightnessControl",
                        "org.kde.Solid.PowerManagement.Actions.BrightnessControl.brightnessMax"])
        
        try:
            current_val, max_val = int(cur_out), int(max_out)
        except (TypeError, ValueError):
            return None
        if max_val <= 0:
            return None
        return {"percent": round(current_val / max_val * 100), "current": current_val, "max": max_val}

    def set_brightness(self, percent: int) -> Optional[Dict[str, Any]]:
        percent = max(5, min(100, percent))  # never 0: that can black out the panel
        if self.mock:
            self._mock_brightness = percent
            return self.get_brightness()

        info = self.get_brightness()
        if info is None:
            return None
        max_val = info["max"]
        target_val = int(round((percent / 100.0) * max_val))
        
        _run(["qdbus", "org.kde.Solid.PowerManagement",
              "/org/kde/Solid/PowerManagement/Actions/BrightnessControl",
              "org.kde.Solid.PowerManagement.Actions.BrightnessControl.setBrightness",
              str(target_val)])
        
        return self.get_brightness()

    def get_all(self) -> Dict[str, Any]:
        return {
            "bluetooth": self.get_bluetooth(),
            "wifi": self.get_wifi(),
            "brightness": self.get_brightness(),
        }
