"""Quick controls for Bluetooth, Wi-Fi, and Screen Brightness on Nobara / KDE Plasma."""
import subprocess
from typing import Dict, Any, Optional

def _run(cmd: list, timeout: float = 2.0) -> Optional[str]:
    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout)
        if res.returncode == 0:
            return res.stdout.strip()
    except Exception:
        pass
    return None

class SystemControls:
    def __init__(self, mock: bool = False):
        self.mock = mock
        self._mock_bt = True
        self._mock_wifi = True
        self._mock_brightness = 40

    def get_bluetooth(self) -> bool:
        if self.mock:
            return self._mock_bt
        out = _run(["bluetoothctl", "show"])
        if out:
            for line in out.splitlines():
                if "Powered:" in line:
                    return "yes" in line.lower()
        return False

    def set_bluetooth(self, enabled: bool) -> bool:
        if self.mock:
            self._mock_bt = enabled
            return self._mock_bt
        arg = "on" if enabled else "off"
        _run(["bluetoothctl", "power", arg])
        return self.get_bluetooth()

    def get_wifi(self) -> bool:
        if self.mock:
            return self._mock_wifi
        out = _run(["nmcli", "radio", "wifi"])
        if out:
            return "enabled" in out.lower()
        return False

    def set_wifi(self, enabled: bool) -> bool:
        if self.mock:
            self._mock_wifi = enabled
            return self._mock_wifi
        arg = "on" if enabled else "off"
        _run(["nmcli", "radio", "wifi", arg])
        return self.get_wifi()

    def get_brightness(self) -> Dict[str, Any]:
        if self.mock:
            return {"percent": self._mock_brightness, "current": self._mock_brightness * 100, "max": 10000}
        
        cur_out = _run(["qdbus", "org.kde.Solid.PowerManagement",
                        "/org/kde/Solid/PowerManagement/Actions/BrightnessControl",
                        "org.kde.Solid.PowerManagement.Actions.BrightnessControl.brightness"])
        max_out = _run(["qdbus", "org.kde.Solid.PowerManagement",
                        "/org/kde/Solid/PowerManagement/Actions/BrightnessControl",
                        "org.kde.Solid.PowerManagement.Actions.BrightnessControl.brightnessMax"])
        
        try:
            current_val = int(cur_out) if cur_out else 4000
            max_val = int(max_out) if max_out else 10000
            max_val = max(max_val, 1)
            pct = int(round((current_val / max_val) * 100))
            return {"percent": pct, "current": current_val, "max": max_val}
        except Exception:
            return {"percent": 40, "current": 4000, "max": 10000}

    def set_brightness(self, percent: int) -> Dict[str, Any]:
        percent = max(0, min(100, percent))
        if self.mock:
            self._mock_brightness = percent
            return self.get_brightness()

        info = self.get_brightness()
        max_val = info.get("max", 10000)
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
