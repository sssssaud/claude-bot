# Claude Bot (Pixel Octo)

## Project goal
**Purpose (Saud, 2026-11-23):** show what each Claude Code session is doing: one octo per running session, so terminals can stay minimised. Comes to the cursor for permissions / when done (built 2026-11-24). Voice → text: **skipped** (Saud, 2026-11-25; code parked in bridge/voice.py). The bot itself never speaks. Details: docs/STATUS.md "Saud's vision".

A transparent, always-on-top desktop companion for Nobara Linux. A 3D voxel version of my Pixel Octo emote character floats on screen, reacts to Claude Code activity and system load (0–100 pressure), shows thinking verbs in a heat-coloured badge, and shows CPU/GPU/RAM, controls and token usage in a click popup. (Keyboard RGB was in the original spec; removed by Saud 2026-11-24.)

Full spec: `PROMPT.md` (read it fully before planning). UI reference: `assets/reference/ui-preview.html`.

## Machine
Dell G15 5530 · i7 13th-gen HX · RTX 3050 6 GB + Intel iGPU (hybrid) · 16 GB RAM · Nobara Linux (Fedora-based, KDE Plasma, Wayland). Use `dnf`, never `apt`.
**Plasma X11 session does not work on this laptop (Saud, 2026-11-20): never suggest it as a fallback.** The app needs only XWayland inside the Wayland session. Fallbacks: `CLAUDE_BOT_OZONE=wayland` (native Wayland window) or the bottom-strip window (PROMPT.md §11).

## Directory map
```
claude-bot/
  CLAUDE.md            this file
  PROMPT.md            master spec
  START_HERE.md        first message to paste into Claude Code
  assets/
    emotes-original/   my 48 emote PNGs + sticker sheets (reference only, never edit)
    reference/         ui-preview.html (approved badge/dock/keyboard look)
  app/                 Electron main + preload (window, click-through, tray, IPC)
  ui/                  React renderer: scene3d/, badge/, hud/, dock/
  bridge/              Python service: server.py, sessions.py, activity.py, telemetry.py, controls.py
  hooks/               claude_hook.py + settings snippet
  tools/               clean_emotes.py
  voxels/              octo.json, props/*.json
  packaging/           udev rule, .desktop, systemd user unit
  docs/                HARDWARE.md, STATUS.md
```
Folders other than `assets/` are created phase by phase, not all up front.

## Stack
- Electron (forced XWayland) + React + Vite + three.js + Framer Motion (badge only)
- Python 3 venv: aiohttp, psutil, nvidia-ml-py, Pillow, numpy, pytest (see requirements.txt); app/kwin.py uses the system's dbus-python + PyGObject
- Bridge on `127.0.0.1:8765` (HTTP + WebSocket)

## Build / run commands
Working now:
- Setup: `./setup.sh` (checks system tools, prints the dnf line if any are missing; .venv, npm + Electron binary, build, tests; asks before installing the Claude Code hooks)
- `./run.sh`: bridge + octos (the normal way). Quit from the tray icon. Start on login: tray checkbox (writes ~/.config/autostart/claude-bot.desktop).
- `npm run app`: octos only, simulated data (Electron relaunches itself on XWayland; `CLAUDE_BOT_OZONE=wayland` = native)
- `npm run dev:web`: 3D octo in a plain browser at http://127.0.0.1:5173 (`?speed=0.1` = slow motion)
- `npm run test:all`: node tests + bridge pytest + sprite self-check
- `.venv/bin/python tools/test_clean_emotes.py`, then `.venv/bin/python tools/clean_emotes.py`

## Working rules
- Map (goal → steps → risks → fallback) before each phase; wait for my OK.
- One phase at a time; test each piece alone before integrating.
- Fake data first, hardware last.
- After each working phase: update `docs/STATUS.md`, commit, tag `phase-N-working`, push to GitHub.
- Hooks must never slow down Claude Code: 300 ms timeout, always exit 0.
- **Keyboard RGB is removed for good (Saud, 2026-11-24): never write to, open or probe the keyboard light controller (USB `187c:0551` AW-ELC, `/dev/hidraw*`, OpenRGB) and don't propose it again.**

## Current status
- Done: spec, emote pack, UI look approved. Phase 0 hardware report, Phase 1 clean sprites + 3D octo, Phase 2 Electron overlay (all 2026-11-20).
- Phase 3 ✅ (2026-11-20): moods/face/badge, simulator dock (state lives in main.js, badge opens it), 13 moves, particles, gaze at a look target. Next: Phase 4 (Python bridge + RGB + real terminal position via KWin), plan needs Saud's OK.
- Stack note: no React (approved badge is plain DOM; see docs/STATUS.md). Badge DOM work runs inside Scene3D's frame (onFrame) to keep CPU down.
- Blockers: none.
- Electron gotchas (measured, see docs/HARDWARE.md): never `appendSwitch('ozone-platform')` (GPU crash); env vars set in main.js don't reach the GPU process.
- 2026-11-23: agy's Phase 4a reviewed + fixed; Claude Code hooks + token usage built and tested (`hooks/`), installed 2026-11-23 (undo: `python3 hooks/install.py --uninstall`). Start everything with `./run.sh`.
- 2026-11-24: one octo per Claude Code session built and live (bridge/sessions.py, hooks send session id + folder name). Attention built (octo comes to the cursor for permissions / when done, via app/kwin.py). Tray (Hide/Show, dock, Masti, Come to my cursor, Start on login, Quit) + single instance built. Keyboard RGB removed (Saud's decision). Eyes follow each session's real terminal window (app/kwin.py). Next: Saud picks (voice → text / one-command setup).
- 2026-11-25: voice → text skipped by Saud (parked, not deleted). Screen-lock pause built + measured (28 % → 1.4 % of a core while locked). Low-battery + full-battery reactions built + checked live (dock Battery slider: < 20 drained, 100 = plugged in → hop); battery reader no longer fakes 100 %. "Done" walk only when the terminal isn't in front (KWin `active`). Octo shows Claude's own summary of each step (option 2, tray "Show details"). Brightness live while dragging. Popup redesigned minimal (4 locked tokens, Inter, beside the octo). Phases A (session moments), B (personalities Friendly/Dramatic/Calm) and C (energy + happiness, popup bars, tray Feelings) done. `./setup.sh` done 2026-11-25 (fresh clone → setup → run.sh verified). All planned work done.
- Save-file: `docs/STATUS.md`. Handover for another agent: `HANDOVER.md` (2026-11-21, Claude weekly quota at 86 %).
