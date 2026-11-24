# Handover: read this first (any agent: Antigravity, Claude, …)

Written 2026-11-21 because Claude's weekly quota ran low. Phases 0–3 are done, tested, pushed
(tags `phase-1-working`, `phase-2-working`, `phase-3-working`, latest `main`).

**Read in this order:** `CLAUDE.md` → `docs/STATUS.md` → `docs/HARDWARE.md` → `PROMPT.md` (original spec;
where STATUS.md says "changed from the spec", STATUS.md wins).

## Run and test (all must pass before and after your change)

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && npm install   # once
npm test                                      # 24 node tests
.venv/bin/python tools/test_clean_emotes.py   # sprite cleaner self-check
./run.sh                                      # bridge + octos (one per Claude Code session); tray icon has Quit
npm run app                                   # octos only, simulated data; click the badge = simulator dock
npm run dev:web                               # same octo in a browser, http://127.0.0.1:5173
```
Close: tray icon → Quit Claude Bot (or `pkill -f 'claude-bot/node_modules/electron/dist/electron'`). Only one copy runs at a time.
Inspect the running app: launch `./node_modules/electron/dist/electron --remote-debugging-port=9223 .`
and use the DevTools protocol on 127.0.0.1:9223 (pages `overlay.html`, `dock.html`).

## Hard rules (each one cost real debugging time; do not "simplify" them away)

1. **Never write to the keyboard controller** (USB `187c:0551` AW-ELC, `/dev/hidraw0`, OpenRGB) without
   Saud's explicit OK. First find out whether it stores every update in flash; if yes, write only on
   mood changes and use its built-in effects. Restore the original colour on exit.
2. **Never call `lspci` or read PCI config in a poll loop**: it wakes the RTX 3050 (measured). Read
   `/sys/bus/pci/devices/0000:01:00.0/power/runtime_status`; touch NVML only when it is `active`.
3. **Never use `app.commandLine.appendSwitch('ozone-platform', …)`**: too late, the GPU process crashed.
   `app/main.js` relaunches itself with `--ozone-platform=x11`. Keep it.
4. **Never suggest a Plasma X11 session**: it doesn't work on this laptop. The app runs on XWayland
   inside the Wayland session. Fallback: `CLAUDE_BOT_OZONE=wayland`.
5. **Click-through is the X11 input shape** (`app/xinput_shape.py`, fed rectangles by `app/main.js`).
   Cursor polling can't work under XWayland. Any new clickable thing (the popup) must be added to the
   rectangles sent via `octo:region` `extras` (max 3 today; raise it if needed).
6. **Every IPC message is checked for sender and values** (pattern in `app/main.js`). Keep it so.
7. **Claude Code integration must never slow Claude Code**: hooks exit 0 within 300 ms, always.
   The status line is already ponytail's script: **wrap it** (forward stdin to it and print its
   output), never replace it.
8. Nobara is Fedora: `dnf`, never `apt`. RTX 3050 has 6 GB VRAM; render on the Intel iGPU.
9. After every working step: update `docs/STATUS.md`, commit (noreply identity from `~/.gitconfig`),
   push, tag `phase-N-working` at the end of a phase, update
   `~/Desktop/Projects/mission-control/STATUS.md`. Never force-push.
10. Saud's style: plan (goal → steps → risks → fallback) and get his OK before each phase; fake data
    first, hardware last; one change at a time; "make it alive first, beauty later".

## Progress since this handover was written

- 2026-11-22 agy: step 1 + 2 (bridge, popup, toasts), `99d4710`.
- 2026-11-23 Claude: reviewed and fixed 4a (`06b83a5`); step 3 built and tested (activity engine,
  hooks, status line wrapper, token row + alerts, installer); installed with Saud's OK, live.
  Remaining: step 4 (keyboard RGB, real terminal position) and step 5.
- 2026-11-23 Saud's vision (docs/STATUS.md): one octo per Claude Code session is the core purpose;
  later attention (permission → octo to the cursor) and voice → text (no text-to-speech, ever).
- 2026-11-24 Claude: emotes moved onto the 3D octo (sticker removed); one octo per session built + live.
- 2026-11-24 Claude: attention built (octo comes to the cursor on PermissionRequest / Stop; cursor via app/cursor.py).
- 2026-11-24 Claude: tray (Hide/Show, dock, Masti, Come to my cursor, Start on login, Quit), single-instance lock.

## What's next (Saud's revised order, 2026-11-21; details in docs/STATUS.md "Saud's additions")

1. **Bridge with real data** (`bridge/`, Python, aiohttp on `127.0.0.1:8765`, reject non-local
   origins, HTTP + WebSocket; fake-data mode first; pytest tests). Telemetry: psutil CPU %, RAM,
   `coretemp` "Package id 0", battery; GPU via `nvidia-ml-py` only when awake (else "asleep");
   fans from `alienware_wmi` (its GPU temp is wrong, don't use it). Controls: Bluetooth
   `bluetoothctl power on|off`, Wi-Fi `nmcli radio wifi on|off`, brightness via KDE D-Bus
   (`org.kde.Solid.PowerManagement` … `BrightnessControl`, or `org.kde.ScreenBrightness`; sysfs
   backlight is not writable). Keep bridge CPU under ~1 % and report it in `GET /health`.
   Electron main replaces its simulator with the bridge's WebSocket state (simulator stays as fallback).
2. **Click the octo → popup panel** (click, not hover): CPU / GPU / RAM usage + temperature, battery,
   Bluetooth, Wi-Fi, brightness slider, Claude Code token usage. **Alert toasts** for a few seconds:
   tokens 80 % and 95 %, CPU ≥ 90 °C, GPU ≥ 83 °C, RAM ≥ 90 %. Thresholds in a config file.
3. **Claude Code → live mood + token usage**: `hooks/claude_hook.py` POSTs events to the bridge
   (event names and payload fields for Claude Code 2.1.330 are in `docs/HARDWARE.md`); a status-line
   wrapper forwards `rate_limits.five_hour` / `seven_day` `used_percentage` + `resets_at` and
   `context_window.used_percentage` to the bridge, then runs ponytail's script.
4. **Keyboard RGB** (rule 1 first) and **real terminal position** for the gaze (a KWin script reports the
   window of the terminal running Claude Code; the overlay already accepts `look: { fx, fy }`).
5. **Tray with Quit, autostart, packaging, voxel props**, then the beauty pass (mood badge and
   sticker move into the popup so the octo looks clean outside).

Future, not scheduled: nothing else; everything Saud asked for is in the list above.
