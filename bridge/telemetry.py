"""Hardware telemetry collection for Claude Bot.

Strict Safety Rules:
1. Never call lspci or touch PCI config space in poll loops (it wakes the dGPU).
2. Check /sys/bus/pci/devices/0000:01:00.0/power/runtime_status first.
   Touch NVML only when it is 'active'. If 'suspended', report asleep.
3. Keep CPU footprint under 1% by caching sysfs paths and polling ACPI fans every 3s.
"""
import glob
import os
import psutil
import time
from typing import Dict, Any, Optional

NVIDIA_PCI_STATUS = "/sys/bus/pci/devices/0000:01:00.0/power/runtime_status"

class TelemetryCollector:
    def __init__(self, pci_status_path: str = NVIDIA_PCI_STATUS, mock: bool = False):
        self.pci_status_path = pci_status_path
        self.mock = mock
        self._last_cpu_percent = 0.0
        self._smooth_cpu = 0.0
        self._alpha = 0.35  # Exponential Moving Average factor
        
        # Caching direct sysfs paths to bypass heavy hwmon directory sweeps
        self._cpu_temp_path = None
        self._fan1_path = None
        self._fan2_path = None
        self._last_fan_time = 0.0
        self._last_fans = {"cpu_rpm": 0, "gpu_rpm": 0}

        if not mock:
            self._discover_sysfs_paths()
            try:
                psutil.cpu_percent(interval=None)
            except Exception:
                pass

    def _discover_sysfs_paths(self):
        """Scans /sys/class/hwmon once at startup to find fast direct paths."""
        try:
            for hwmon in glob.glob("/sys/class/hwmon/hwmon*"):
                name_path = os.path.join(hwmon, "name")
                if not os.path.isfile(name_path):
                    continue
                try:
                    with open(name_path, "r") as f:
                        name = f.read().strip()
                except Exception:
                    continue

                if name == "coretemp":
                    # Look for "Package id 0" label
                    for label_file in glob.glob(os.path.join(hwmon, "temp*_label")):
                        try:
                            with open(label_file, "r") as lf:
                                if "Package id 0" in lf.read():
                                    input_file = label_file.replace("_label", "_input")
                                    if os.path.isfile(input_file):
                                        self._cpu_temp_path = input_file
                                        break
                        except Exception:
                            pass
                    if not self._cpu_temp_path:
                        default_t1 = os.path.join(hwmon, "temp1_input")
                        if os.path.isfile(default_t1):
                            self._cpu_temp_path = default_t1

                elif name == "alienware_wmi":
                    f1 = os.path.join(hwmon, "fan1_input")
                    f2 = os.path.join(hwmon, "fan2_input")
                    if os.path.isfile(f1):
                        self._fan1_path = f1
                    if os.path.isfile(f2):
                        self._fan2_path = f2
        except Exception:
            pass

    def get_cpu(self) -> Dict[str, Any]:
        if self.mock:
            return {"usage": 24.0, "temp": 52.0}

        # 1. CPU Usage
        try:
            raw_usage = psutil.cpu_percent(interval=None)
            if self._smooth_cpu == 0.0:
                self._smooth_cpu = raw_usage
            else:
                self._smooth_cpu = (self._alpha * raw_usage) + ((1.0 - self._alpha) * self._smooth_cpu)
            usage = round(self._smooth_cpu, 1)
        except Exception:
            usage = 0.0

        # 2. CPU Temperature (fast direct read, fallback to psutil)
        temp = None
        if self._cpu_temp_path and os.path.isfile(self._cpu_temp_path):
            try:
                with open(self._cpu_temp_path, "r") as f:
                    temp = round(int(f.read().strip()) / 1000.0, 1)
            except Exception:
                temp = None

        if temp is None:
            try:
                temps = psutil.sensors_temperatures()
                if "coretemp" in temps:
                    for entry in temps["coretemp"]:
                        if entry.label == "Package id 0":
                            temp = round(entry.current, 1)
                            break
                    if temp is None and len(temps["coretemp"]) > 0:
                        temp = round(temps["coretemp"][0].current, 1)
            except Exception:
                pass

        return {"usage": usage, "temp": temp}

    def get_ram(self) -> Dict[str, Any]:
        if self.mock:
            return {"percent": 45.0, "used_gb": 7.2, "total_gb": 16.0}

        try:
            vm = psutil.virtual_memory()
            return {
                "percent": round(vm.percent, 1),
                "used_gb": round((vm.total - vm.available) / (1024 ** 3), 2),
                "total_gb": round(vm.total / (1024 ** 3), 1),
            }
        except Exception:
            return {"percent": 0.0, "used_gb": 0.0, "total_gb": 16.0}

    def get_battery(self) -> Dict[str, Any]:
        if self.mock:
            return {"percent": 100.0, "plugged": True}

        try:
            bat = psutil.sensors_battery()
            if bat:
                return {
                    "percent": round(bat.percent, 1),
                    "plugged": bool(bat.power_plugged),
                }
        except Exception:
            pass
        return {"percent": 100.0, "plugged": True}

    def get_fans(self) -> Dict[str, Any]:
        if self.mock:
            return {"cpu_rpm": 1700, "gpu_rpm": 1900}

        # Rate-limit fan reading to once every 3 seconds (Dell ACPI calls take ~5 ms)
        now = time.time()
        if now - self._last_fan_time < 3.0:
            return self._last_fans

        cpu_rpm = 0
        gpu_rpm = 0
        if self._fan1_path and self._fan2_path:
            try:
                with open(self._fan1_path, "r") as f:
                    cpu_rpm = int(f.read().strip())
                with open(self._fan2_path, "r") as f:
                    gpu_rpm = int(f.read().strip())
                self._last_fans = {"cpu_rpm": cpu_rpm, "gpu_rpm": gpu_rpm}
                self._last_fan_time = now
                return self._last_fans
            except Exception:
                pass

        try:
            fans = psutil.sensors_fans()
            if "alienware_wmi" in fans:
                for fan in fans["alienware_wmi"]:
                    if "cpu" in fan.label.lower():
                        cpu_rpm = fan.current
                    elif "gpu" in fan.label.lower():
                        gpu_rpm = fan.current
            self._last_fans = {"cpu_rpm": cpu_rpm, "gpu_rpm": gpu_rpm}
            self._last_fan_time = now
        except Exception:
            pass

        return self._last_fans

    def get_dgpu(self) -> Dict[str, Any]:
        """Safely inspects the RTX 3050 without waking it if suspended."""
        if self.mock:
            return {
                "available": True,
                "awake": False,
                "status": "asleep",
                "usage": 0,
                "temp": None,
                "vram_used_mb": 25,
                "vram_total_mb": 6144,
                "power_w": 0.0,
            }

        if not os.path.exists(self.pci_status_path):
            return {
                "available": False,
                "awake": False,
                "status": "not_found",
                "usage": 0,
                "temp": None,
                "vram_used_mb": 0,
                "vram_total_mb": 6144,
                "power_w": 0.0,
            }

        try:
            with open(self.pci_status_path, "r") as f:
                runtime_status = f.read().strip()
        except Exception:
            runtime_status = "unknown"

        # Hard Rule 2: If suspended, touch NVML never!
        if runtime_status != "active":
            return {
                "available": True,
                "awake": False,
                "status": "asleep",
                "usage": 0,
                "temp": None,
                "vram_used_mb": 0,
                "vram_total_mb": 6144,
                "power_w": 0.0,
            }

        # dGPU is active: safely query NVML
        try:
            import pynvml
            pynvml.nvmlInit()
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            rates = pynvml.nvmlDeviceGetUtilizationRates(handle)
            temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
            mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
            try:
                power = pynvml.nvmlDeviceGetPowerUsage(handle) / 1000.0
            except Exception:
                power = 0.0
            pynvml.nvmlShutdown()

            return {
                "available": True,
                "awake": True,
                "status": "active",
                "usage": rates.gpu,
                "temp": temp,
                "vram_used_mb": round(mem.used / (1024 * 1024)),
                "vram_total_mb": round(mem.total / (1024 * 1024)),
                "power_w": round(power, 1),
            }
        except Exception as e:
            return {
                "available": True,
                "awake": True,
                "status": f"error: {str(e)}",
                "usage": 0,
                "temp": None,
                "vram_used_mb": 0,
                "vram_total_mb": 6144,
                "power_w": 0.0,
            }

    def snapshot(self) -> Dict[str, Any]:
        """Collects full 1 Hz telemetry payload."""
        cpu = self.get_cpu()
        gpu = self.get_dgpu()
        ram = self.get_ram()
        battery = self.get_battery()
        fans = self.get_fans()

        return {
            "cpu": cpu,
            "gpu": gpu,
            "ram": ram,
            "battery": battery,
            "fans": fans,
        }
