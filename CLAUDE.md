# Claude Bot (Pixel Octo)

## Project goal
A transparent, always-on-top desktop companion for Nobara Linux. A 3D voxel version of my Pixel Octo emote character floats on screen, reacts to Claude Code activity and system load (0–100 pressure), shows thinking verbs in a heat-coloured badge, always shows tiny CPU/GPU usage and temperature, and syncs the Dell G15's 4-zone keyboard RGB to its mood.

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
  bridge/              Python service: server.py, pressure.py, telemetry.py, rgb/
  hooks/               claude_hook.py + settings snippet
  tools/               clean_emotes.py
  voxels/              octo.json, props/*.json
  packaging/           udev rule, .desktop, systemd user unit
  docs/                HARDWARE.md, STATUS.md
```
Folders other than `assets/` are created phase by phase, not all up front.

## Stack
- Electron (forced XWayland) + React + Vite + three.js + Framer Motion (badge only)
- Python 3 venv: aiohttp, psutil, nvidia-ml-py, openrgb-python, hidapi, pyyaml, Pillow, numpy
- Bridge on `127.0.0.1:8765` (HTTP + WebSocket)

## Build / run commands
Working now:
- Setup: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && npm install`
- `npm run app`: build + the desktop overlay (Electron, relaunches itself on XWayland; `CLAUDE_BOT_OZONE=wayland` = native)
- `npm run dev:web`: 3D octo in a plain browser at http://127.0.0.1:5173 (`?speed=0.1` = slow motion)
- `npm test`: node tests (model, face culling, moves, frame budget, window placement)
- `.venv/bin/python tools/test_clean_emotes.py`, then `.venv/bin/python tools/clean_emotes.py`
Still to come: `./setup.sh` (dnf deps), `./run.sh` (bridge + Electron), `pytest bridge/tests`.

## Working rules
- Map (goal → steps → risks → fallback) before each phase; wait for my OK.
- One phase at a time; test each piece alone before integrating.
- Fake data first, hardware last.
- After each working phase: update `docs/STATUS.md`, commit, tag `phase-N-working`, push to GitHub.
- Hooks must never slow down Claude Code: 300 ms timeout, always exit 0.
- Never run anything that writes to the keyboard controller before Phase 4 is planned and approved.

## Current status
- Done: spec, emote pack, UI look approved. Phase 0 hardware report, Phase 1 clean sprites + 3D octo, Phase 2 Electron overlay (all 2026-11-20).
- Phase 3 ✅ (2026-11-20): moods/face/badge, simulator dock (state lives in main.js, badge opens it), 13 moves, particles, gaze at a look target. Next: Phase 4 (Python bridge + RGB + real terminal position via KWin), plan needs Saud's OK.
- Stack note: no React (approved badge is plain DOM; see docs/STATUS.md). Badge DOM work runs inside Scene3D's frame (onFrame) to keep CPU down.
- Blockers: none. Open: AW-ELC flash-write question (Phase 4).
- Electron gotchas (measured, see docs/HARDWARE.md): never `appendSwitch('ozone-platform')` (GPU crash); env vars set in main.js don't reach the GPU process.
- Save-file: `docs/STATUS.md`.
