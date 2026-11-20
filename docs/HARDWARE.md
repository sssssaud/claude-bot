# Phase 0 — Hardware & environment report

Checked 2026-11-20. Only read-only commands were run: nothing was installed, no
setting was changed, and nothing was sent to the keyboard controller. OpenRGB
detection was **not** re-run, because detection sends HID reports to the
controller. Its own log from 2026-11-16 was read instead.

## Summary

| Item | Result |
|---|---|
| OS / kernel | Nobara Linux 44, kernel `7.3.4-202.nobara.fc44.x86_64` |
| Session | KDE Plasma **6.7.5**, **Wayland** (`WAYLAND_DISPLAY=wayland-0`, XWayland on `DISPLAY=:0`) |
| Displays | 1 output: `eDP-1` 1920×1080, scale 1, priority 1 (no external monitor at check time) |
| iGPU | Intel Raptor Lake-S UHD, `0000:00:02.0`, DRM `card1`, drives `eDP-1` |
| dGPU | RTX 3050 6 GB Laptop (GA107BM), `0000:01:00.0`, DRM `card0`, driver **620.70.06**, `power/control=auto` |
| Default GL renderer (XWayland) | `Mesa Intel(R) Graphics (RPL-S)` → Electron renders on the iGPU by default |
| Power | AC online, `BAT0` 100 %, "Not charging" |
| Keyboard lighting | USB **`187c:0551` "Alienware AW-ELC"**, bcdDevice 2.00, HID, 33-byte packets, `/dev/hidraw0` |
| hidraw0 access | ACL `user:saud:rw-` (from `openrgb-udev-rules`, tag `Dell_G_Series_LED_Controller`, `uaccess`) |
| OpenRGB | `openrgb-1.0-3.20260920git0f8f2dc.fc44` (rpm) + `openrgb-udev-rules`; **SDK server not running** (`127.0.0.1:6742` refused) |
| Kernel lighting/fan modules | `alienware_wmi` (`alienware-wmi-wmax`), `dell_laptop`, `dell_smm_hwmon`, `dell_wmi_ddv` |
| Kernel LED | `dell::kbd_backlight` brightness 2 / max 2 (brightness only, no colour) |
| Platform profile | choices `quiet balanced performance`, current `balanced` |
| Other HID | External keyboard RDR EvoFox Ronin TKL (`320f:5055`, hidraw4/5); USB mouse. Out of scope. |

## OpenRGB detection (from its own log, 2026-11-16 19:10)

```
552 |Info: |               Detecting HID devices                |
724 |Info: [AlienWare Controller] Known platform:      E0A, Number of zones: 4
785 |Info: [Dell G Series LED Controller] Registering RGB controller
802 |Info: |                Detection completed                 |
```
→ OpenRGB detects the keyboard as **one device with 4 zones**. Its `OpenRGB.json` has the
"Dell G Series LED Controller" detector enabled and no SDK server section.

## Sensors

| hwmon | name | Useful values at check time |
|---|---|---|
| hwmon0 | AC | — |
| hwmon1 | BAT0 | — |
| hwmon2 | nvme | — |
| hwmon3 | ucsi_source_psy_USBC000:001 | — |
| hwmon4 | **alienware_wmi** | `CPU Fan` 1705 rpm, `GPU Fan` 1968 rpm, temp `CPU` 62 °C, temp `GPU` 30 °C |
| hwmon5 | spd5118 | (RAM) |
| hwmon6 | dell_ddv | — |
| hwmon7 | **dell_smm** | fan1 1709 rpm, fan2 2014 rpm (no labels) |
| hwmon8 | iwlwifi_1 | — |
| hwmon9 | **coretemp** | `Package id 0` 62 °C, cores 58–59 °C |

- `psutil 7.2.2`: `sensors_temperatures()` keys =
  `['BAT0', 'nvme', 'alienware_wmi', 'spd5118', 'dell_ddv', 'dell_smm', 'iwlwifi_1', 'coretemp']`;
  `coretemp` → `Package id 0` = 64.0 °C. `sensors_battery()` = 100 %, plugged.
- Fan RPM for the hover card: prefer `alienware_wmi` (it labels CPU and GPU fans).
- ⚠ `alienware_wmi` "GPU" read **30 °C** while `nvidia-smi` read **52.38 °C** (see below).
  It is not the GPU die temperature, so don't show it as `G` unless Phase 5 proves otherwise.

`nvidia-smi` (dGPU awake):
```
NVIDIA GeForce RTX 3050 6GB Laptop GPU, 620.70.06, 6 %, 52.38, 25 MiB, 6144 MiB, 12.73 W
```
`kwin_wayland` holds a 6 MiB context on the dGPU, but the dGPU still suspends when idle.

## dGPU sleep: what wakes it (measured)

Starting from `runtime_status = suspended`:

| Read | runtime_status after |
|---|---|
| `ls /sys/bus/pci/drivers/nvidia/` (finds `0000:01:00.0`) | suspended ✅ |
| `cat /sys/class/hwmon/hwmon4/temp2_input` (alienware GPU temp) | suspended ✅ |
| `lspci -D -d 10de:` | **active** ❌ (reading PCI config space wakes it) |

**Rule for Phase 5:** find the NVIDIA address via `/sys/bus/pci/drivers/nvidia/` (or config).
Never call `lspci` or read PCI config in the poll loop. Read only `power/runtime_status`
and touch NVML only when it is `active`.

## Toolchain

| Tool | Version / state |
|---|---|
| Python | 3.14.8 (system has psutil 7.2.2, Pillow 12.3.0, numpy 2.4.6, `pynvml` and `hid` importable; `openrgb` not installed). The project will use its own `.venv`. |
| Node / npm | v24.22.3 (user-local, `~/.local/bin/node`) / 11.19.1 |
| Claude Code | **2.1.329** (`~/.local/share/claude/versions/2.1.329`) |
| Present | `kscreen-doctor`, `xprop`, `glxinfo` |
| Missing | `playerctl` (needed for "music playing" in Phase 6: `sudo dnf install playerctl`), `xdotool` (not needed) |

## Claude Code hooks (checked against the installed 2.1.329 binary)

All six events the spec uses exist: `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`,
`SubagentStop`, `Notification`. Also present: `PostToolUseFailure`, `SubagentStart`,
`StopFailure`, `PermissionRequest`, `PermissionDenied`, `SessionStart`, `SessionEnd`,
`PreCompact`, `PostCompact`, `TaskCreated`, `TaskCompleted`, and others.

Event-specific payload fields (from the schemas in the binary):

| Event | Fields |
|---|---|
| `PreToolUse` | `tool_name`, `tool_input`, `tool_use_id`, `mcp_server?` |
| `PostToolUse` | `tool_name`, `tool_input`, `tool_response`, `tool_use_id`, `duration_ms?`, `mcp_server?` |
| `PostToolUseFailure` | `tool_name`, `tool_input`, `tool_use_id`, `error`, `is_interrupt?`, `duration_ms?`, `mcp_server?` |
| `SubagentStart` | `agent_id`, `agent_type` |
| `SubagentStop` | `stop_hook_active`, `agent_id`, `agent_transcript_path`, `agent_type`, `last_assistant_message?`, `background_tasks?` |
| `Stop` | `stop_hook_active`, `last_assistant_message?`, `background_tasks?` |
| `Notification` | `message`, `title?`, `notification_type` |
| `UserPromptSubmit` | `prompt`, `source?` (`user`/`sdk`/`system`/`loop_wakeup`/`schedule_wakeup`/`poll_event`) |

Common fields seen in the binary: `hook_event_name`, `session_id`, `transcript_path`, `permission_mode`.

**Spec changes for Phase 6:**
1. Failed tools fire **`PostToolUseFailure`**, and `PostToolUse` has no success flag.
   So `ok = event != "PostToolUseFailure"`, and `is_interrupt = true` (I pressed Esc) is not an error.
2. Track sub-agents with **`SubagentStart` / `SubagentStop` by `agent_id`**, not by tool name.
   The sub-agent tool is called `Agent` in this version, not `Task`.
3. `Notification.notification_type` can tell "needs input" apart from other notifications
   (log its real values in Phase 6).

## Transcripts

80 `*.jsonl` files under `~/.claude/projects/` (45 project folders). Contents were not read.
The format check for the optional transcript fallback is deferred to Phase 6.

## Source art (for Phase 1)

- The 48 crops are 256×256 RGB. They are blurry upscales (`01_hello` has 7,998 colours) and
  the cuts are imprecise: `13_gaming` and `14_coding` are cut off at the edge, `29_coffee` and
  `36_sprout` include bits of neighbouring stickers, and `01_hello` has a page-margin band.
- **Names that don't match the art:** `17_headphones` shows a **workout** octo (headband +
  dumbbells); `30_sunny` shows a **yellow raincoat in rain**; `37_spa` shows the octo **on a
  purple cloud with stars**. (`12_music` already has the headphones.)
- `sheets/sheet_48_emotes.png`: 1536×1024 **RGBA**, the same 48 stickers, crisper, with a real
  alpha channel (33.5 % of pixels fully transparent). One art pixel ≈ 10–11 screen px
  (measured on the eyes).
- `sheets/sticker_sheet_original.png`: the same layout, RGB.
- `sheets/sheet_86_categories.png`: a different, labelled 86-emote set (smaller cells). It has
  proper **Headset/Music, Sun, Spa**, plus **Melted, Sleeping, Wave**, which are useful pose
  references for the `melt`, `sleep` and `wave` moves. There are no individual files for it.

## RGB driver tier

**Tier 1, OpenRGB SDK: available.** OpenRGB 1.0 is installed, has detected the AW-ELC as
one 4-zone device, and I already have rw access through its udev rules. Phase 4 still needs:
the SDK server started (`openrgb --server`, plus autostart), `openrgb-python` in the venv, and
an answer to the open question of **whether the AW-ELC writes each update to flash** before
any streaming.

Tier 2 (direct `hidapi` on `187c:0551`) stays as the fallback. Access is already granted, so
the custom udev rule is only needed on machines without `openrgb-udev-rules`.
Tier 3 (mock strip) is always available.
