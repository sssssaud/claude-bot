# Claude Bot (Pixel Octo)

## Project goal
A transparent, always-on-top desktop companion for Nobara Linux. A 3D voxel version of my Pixel Octo emote character floats on screen, reacts to Claude Code activity and system load (0–100 pressure), shows thinking verbs in a heat-coloured badge, always shows tiny CPU/GPU usage and temperature, and syncs the Dell G15's 4-zone keyboard RGB to its mood.

Full spec: `PROMPT.md` (read it fully before planning). UI reference: `assets/reference/ui-preview.html`.

## Machine
Dell G15 5530 · i7 13th-gen HX · RTX 3050 6 GB + Intel iGPU (hybrid) · 16 GB RAM · Nobara Linux (Fedora-based, KDE Plasma, Wayland). Use `dnf`, never `apt`.

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
- `npm run dev:web`: 3D octo in a plain browser at http://127.0.0.1:5173 (`?speed=0.1` = slow motion)
- `npm test`: node tests (model, face culling, moves, frame budget)
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
- Done: spec, emote pack, UI look approved. Phase 0 hardware report (2026-11-20). Phase 1: clean sprites + 3D octo in the browser (2026-11-20).
- Pending: Phase 2 (Electron transparent overlay on Nobara), plan needs Saud's OK.
- Blockers: none. Open: AW-ELC flash-write question (Phase 4); real-iGPU FPS not measured yet (headless browser is software-rendered).
- Save-file: `docs/STATUS.md`.
