# Claude Bot — Master Build Spec (v3: 3D Pixel Octo + Telemetry HUD)

Build a production-grade, transparent, always-on-top **desktop companion** for **Nobara Linux (KDE Plasma, Wayland session)** on a **Dell G15 5530** (i7 13th-gen HX, RTX 3050 6 GB, Intel iGPU, 16 GB RAM).

The companion is **Pixel Octo**: the orange pixel-art octopus from my own emote pack (`assets/emotes-original/`), rebuilt as a **chunky 3D voxel toy** that can turn around, jump, roll and react. It reacts in real time to my AI workload (Claude Code activity + system load), shows Claude-style "thinking verbs" in a heat-coloured badge, **always shows CPU and GPU usage and temperature in a tiny HUD**, and syncs my keyboard's 4-zone RGB backlight to its mood.

`assets/reference/ui-preview.html` is the approved look for the **badge, simulator dock and keyboard strip**. Its blob mascot is **replaced** by the 3D octo described here.

---

## 0. Ground rules for the agent

- Map before action: for every phase, state goal → steps → risks → fallback, then wait for my OK.
- One phase at a time. Each phase ends with something I can run and see, a short `docs/STATUS.md` update, and a git commit + tag (`phase-N-working`).
- Fake data first, real hardware last. The simulator must drive everything before any hardware code exists.
- Never block or slow down Claude Code itself. Hooks must fail silently and exit 0 within 300 ms.
- Minimal code, modular folders, no unrequested abstractions. Never cut error handling.

---

## 1. Platform reality (Linux, not Windows)

These replace the Windows/AWCC assumptions from older versions of this prompt.

| Problem | Required fix |
|---|---|
| Electron on Wayland cannot set always-on-top or its own position. | Force XWayland: `app.commandLine.appendSwitch('ozone-platform', 'x11')` before `app.ready` (or `ELECTRON_OZONE_PLATFORM_HINT=x11`). |
| `setIgnoreMouseEvents(true, { forward: true })` — `forward` does not work on Linux. | Main process polls `screen.getCursorScreenPoint()` every ~40 ms, hit-tests it against the octo's and badge's screen rects (sent from the renderer via IPC), and toggles `setIgnoreMouseEvents(true/false)`. Clicks pass through everywhere else. |
| Transparent windows can render black on Linux. | Use `transparent: true`, `backgroundColor: '#00000000'`, `frame: false`; add `--enable-transparent-visuals` and create the window ~300 ms after ready if needed. Test this alone in Phase 2. |
| Global hotkey `Ctrl+Shift+M` is unreliable under XWayland. | Register it with `globalShortcut`; also expose `POST /masti` on the bridge so a KDE Custom Shortcut can run `curl -s -X POST 127.0.0.1:8765/masti`. |
| No AWCC on Linux. | No AWCC conflict exists. Needs a udev rule for the keyboard lighting controller (`187c:0551`) so the bridge works without root. |
| Hybrid graphics: rendering or polling the RTX 3050 keeps it awake and drains battery. | Electron renders on the **Intel iGPU** (never launch with `prime-run`). GPU telemetry reads `/sys/bus/pci/devices/<nvidia>/power/runtime_status` first; if `suspended`, show `GPU zZ` and **do not touch NVML**. |
| Multi-monitor or resolution change can lose the window off-screen. | Save the position as a fraction of the current display's work area plus the display id. On start and on `display-metrics-changed`/`display-removed`, clamp it back inside the nearest display's `workArea`. |

---

## 2. Architecture

```
┌───────────── Electron (renderer: React + three.js) ─────────────┐
│ 3D Octo scene · Verb badge · Telemetry HUD · Simulator dock     │
└──────────────▲─────────────────────────────┬────────────────────┘
               │ WebSocket ws://127.0.0.1:8765/ws (state @10 Hz,  │
               │ telemetry @1 Hz)                                 │ overrides (slider, mood, masti)
┌──────────────┴─────────────────────────────▼────────────────────┐
│ Python bridge (aiohttp, one process)                             │
│  pressure.py   hooks + system load + simulator → 0–100 score    │
│  telemetry.py  CPU/GPU usage + temps, RAM, VRAM, battery        │
│  rgb/          throttled HSV-lerped keyboard writer (3 drivers) │
│  HTTP: POST /event (Claude hooks), POST /masti, GET /health     │
└──────────────▲──────────────────────────────────────────────────┘
               │ POST /event
     Claude Code hooks (hooks/claude_hook.py)
```

- The **bridge is the brain** (state, scores, hardware); **Electron is the face** (render only).
- The bridge binds to `127.0.0.1` only. Reject non-local origins on the WebSocket.
- If the bridge is down, the app keeps running in simulator mode and shows a small "bridge offline" dot.

---

## 3. The 3D Pixel Octo (core of v3)

### 3.1 Source art — be honest about the pack
The emote PNGs are 256×256 **RGB** crops (not transparent). They keep the sheet background and a white sticker border, and the pixels are anti-aliased (thousands of colours), so they cannot be voxelized directly.

Therefore:
1. `tools/clean_emotes.py` turns each PNG into a clean 2D sprite: flood-fill the background and white border to transparent from the corners, detect the pixel-grid size, downsample to the true grid with a per-cell mode colour, and quantize to a small palette. Output goes to `assets/emotes-clean/<name>.png` plus a contact sheet for me to review.
2. The **3D base octo is authored as a clean voxel model** (`voxels/octo.json`) using the clean sprites and the two sheets in `assets/emotes-original/sheets/` as reference. It is not auto-extruded from the noisy PNGs.
3. Props are small voxel models in `voxels/props/*.json` (text-layer format: one character grid per Z slice, plus a palette). Any emote whose prop is not modelled yet falls back to its **clean 2D sprite shown as a billboard** next to the 3D octo, so all 48 emotes work from day one.

### 3.2 Model
- Body: the octo silhouette from the sheet (rounded block body, side nubs as arms), about 1/3 as deep as it is wide, with chamfered back edges so it reads as a toy when it turns.
- **8 legs**: 4 front and 4 back. The back row shows when it turns around.
- Face is on the front only: two dark rectangular eyes, optional blush. The back is plain body colour.
- Face parts are separate groups so expressions swap instantly: eyes (`open`, `happy ^ ^`, `angry > <`, `sleepy – –`, `wink`, `heart`, `x x`, `closed`), mouth (`none`, `smile`, `o`, `grit`, `smirk`), extras (blush, tears, sweat, anger mark).
- Palette: the pack's orange (sample from clean sprites), darker side-face shade, dark eyes, pink blush.

### 3.3 Rendering
- three.js inside React (plain three.js in one `Scene3D` module; no extra 3D framework needed). `WebGLRenderer({ alpha: true, antialias: false })`, clear alpha 0.
- **One `InstancedMesh` per material**; target under 3,000 voxels on screen.
- Orthographic camera, slight top-down tilt (~12°) so the front view looks like the original sprite and turning shows depth.
- Flat **toon shading** (2–3 step gradient) plus hemisphere and key light. Keep the pixel-art feel; no realistic PBR.
- **White sticker outline** using an inverted-hull mesh (back-faces, scaled ~1.06, white) to match the pack's sticker border. Make it a setting.
- Soft blob shadow under the octo, scaled by jump height.
- Frame budget: 60 FPS while animating, drop to 24 FPS when idle, pause when the screen is locked or the window is hidden. Render on the iGPU.

### 3.4 Motion library (all procedural, all interruptible)
Every move uses springs or eased keyframes with **anticipation → action → overshoot → settle**, plus squash and stretch that preserves volume.

| Move | Description | Default trigger |
|---|---|---|
| `idleBob` | ±6 px sine hover, slow breathing scale, leg sway | always (base layer) |
| `blink` | eyes close for 120 ms, every 3–5 s, randomized | always |
| `lookAt` | body yaws up to ±25° and eyes shift toward the cursor | cursor nearby |
| `turnAround` | 360° yaw spin, back side and back legs visible mid-turn | click on octo, task finished |
| `peekTurn` | 90° turn, glance over shoulder, turn back | random idle |
| `jump` | squash 0.15 s → stretch launch → airborne → land squash → wobble | `Stop` hook (task done), click |
| `flipJump` | jump plus 360° forward flip | task done after long or overdrive work |
| `roll` | sideways barrel roll travelling 1–2 body widths | random idle, drag release with speed |
| `tumble` | forward roll then sit up dizzy, `@ @` eyes | after overdrive ends |
| `walk` | 8-leg wave gait, small waddle, moves along screen bottom | long idle (go to screen edge and sit) |
| `shake` | 1–2 px high-frequency jitter | overdrive (76–100%) |
| `melt` | scale Y down to 0.6 and spread out, then reform | GPU or CPU temp over threshold |
| `sleep` | sinks lower, eyes `– –`, zZz particles | idle over 5 min |
| `dance` | rhythmic hops with alternating tilt | masti, music playing |
| `wave` | one arm nub waves | app start (`01_hello`), hover after long absence |
| `dragFlail` | legs flail while dragged; drop → squash bounce | drag and drop |

Moves layer: the base layer is always running, and one-shot actions blend on top and return to the current mood pose. A queue prevents overlapping one-shots.

### 3.5 Moods (pressure score drives them)

| Mood | Pressure | Octo pose and particles | Emote pool (from my pack) | Keyboard RGB |
|---|---|---|---|---|
| Idle / chill | 0–15 | Slow bob, half-closed eyes, mug prop, zZz | 29 coffee, 20 cozy, 26 boba, 30 sunny, 36 sprout | Breathing terracotta/amber, 0.2 Hz |
| Light work | 16–45 | Alert eyes, small forward lean, orbiting `{ }` `</>` | 09 thinking, 15 studying, 16 reading, 10 idea | Steady coral-orange |
| Deep coding | 46–75 | Determined eyes, laptop + terminal props, sparks, quick micro-bounce | 14 coding, 25 cooking, 28 chef, 43 wizard | Energetic orange pulse |
| Overdrive | 76–100 | Angry eyes, gritted mouth, sweat, steam puffs, shake, crimson aura ring | 11 angry, 18 strong, 19 lifting, 07 surprised (on spike) | Crimson heartbeat 1.5 Hz + slight flicker |
| Masti | hotkey / button / 25 s+ idle | Tilt, wink, smirk, **red rose clenched horizontally in mouth** (voxel prop), hearts and sparkles, `dance` | 02 love, 06 laughing, 04 cool, 03 hug_cat, 39 angel, 40 devil | Magenta-rose shimmer `#FF0055` ↔ `#FF758F` |

Emote pools rotate every 8–15 s within a mood. A mood change crossfades over ~400 ms (eyes swap at the midpoint of a quick `peekTurn` so it feels intentional).

### 3.6 Context emotes (event driven, override the mood pool for 4–8 s)

| Event | Emote | Move |
|---|---|---|
| App start | 01 hello | wave |
| Claude `Stop` (task done) | 04 cool or 10 idea | jump / flipJump |
| Tool error or failed Bash | 08 confused (3+ in a row: 05 crying) | small hop back |
| Claude `Notification` (needs my input) | 07 surprised | jump + look at cursor |
| Sub-agent running (`Task` tool) | 44 magic | orbiting sparkles |
| Web search or fetch tools | 46 traveler | — |
| Risky Bash (`rm -rf`, `git push --force`, `sudo`) | 40 devil | peekTurn |
| CPU over 90 °C | 21 sick (thermometer) | — |
| GPU over 83 °C | melt + sweat | melt |
| Temps below 45 °C and idle | 32 snowy | — |
| Cooling down after overdrive | 37 spa, then 22 healing | tumble |
| Battery under 20%, unplugged | 23 low_battery | sleep-ish droop |
| Plugged in and full | 24 full_battery | small hop |
| Music playing (`playerctl status` = Playing) | 17 headphones / 12 music / 48 guitar | dance |
| Game running (Steam/Proton process) | 13 gaming / 47 vr_gamer | — |
| Fullscreen app focused | 35 cardboard_box (octo hides in box, HUD stays) | — |
| Dec 24–26 | 42 christmas | — |
| Configured birthday (`config.birthday_mmdd`) | 41 birthday | flipJump |

All thresholds live in `config.yaml`.

---

## 4. Thinking-verb badge (keep from the approved preview)
- A pill tethered beside the octo with spring physics; it flips to the other side near screen edges.
- Verb swap: vertical slot slide + blur fade, every 4 s at 0% pressure down to every 2.5 s at 100%.
- Verb pools:
  - 0–30: Percolating, Simmering, Daydreaming, Tinkering, Vibing, Brewing
  - 31–70: Blooming, Seasoning, Weaving, Architecting, Synthesizing, Refactoring
  - 71–100: Overclocking, Inferno-compiling, Hyper-threading, Crunching, Melting-silicon, Turbo-seasoning
  - Masti: Charming, Smooth-talking, Rizzing, Taking-a-breather
- Colour lerps continuously `#E07A5F` → `#FF5500` → `#FF1E00` (masti: `#FF0055` ↔ `#FF758F`) for background tint, border glow and text.
- Above 80%: heat shimmer (animate a transform, not an SVG filter, to keep it cheap) and rising embers.
- A small rotating spinner glyph at the left and the pressure % at the right in mono.

---

## 5. Telemetry HUD (always visible, as small as possible)

A single line under the octo, **10–11 px JetBrains Mono, ~150 px wide**, glass background, never overlapping the octo:

```
C 23% 58°  G  7% 49°
```

- `C` = CPU total usage % and package temperature. `G` = RTX 3050 utilization % and temperature.
- Each number is colour coded: under 70 °C neutral, 70–84 °C amber, 85 °C+ red (usage: under 60% neutral, 60–89% amber, 90%+ red).
- Tiny 2 px bar under each value showing usage.
- dGPU asleep → `G zZ` (dim). No NVIDIA driver → `G –`.
- **Hover** expands it into a small card: RAM used/16 GB, VRAM used/6 GB, GPU power W, CPU frequency, top process by CPU, battery % and charging state, fan RPM if `dell_smm_hwmon` exposes it.
- A setting can collapse it to an **ultra-mini** mode: two 24 px micro-bars with temperature dots.
- Updates at **1 Hz**, with values smoothed (EMA) so they don't jump around.

### Data sources (Linux)
- CPU usage: `psutil.cpu_percent(interval=None)`.
- CPU temp: `psutil.sensors_temperatures()["coretemp"]`, label `Package id 0`. Fall back to scanning `/sys/class/hwmon/*/name`.
- GPU: `nvidia-ml-py` (`pynvml`) for utilization, temperature, memory and power. **Only** when `runtime_status` is `active`. Call `nvmlInit`/`nvmlShutdown` around each read if holding the handle stops the GPU from sleeping (measure this in Phase 5).
- Battery: `psutil.sensors_battery()`.
- The bridge must not cost more than ~1% CPU. Measure it and print it in `/health`.

---

## 6. Workload / pressure engine

Three inputs, blended into one 0–100 score:

1. **Claude Code hooks (primary).** `hooks/claude_hook.py` is registered in `~/.claude/settings.json` for `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop` and `Notification` (check the exact event names and payload fields against the installed Claude Code version's hooks docs before wiring). It reads the JSON payload from stdin, POSTs `{event, tool_name, ok, ts}` to `127.0.0.1:8765/event` with a 300 ms timeout, and always exits 0.
   - Weights per event: Edit/Write/MultiEdit 3, Bash 2, Read/Grep/Glob 1, Task (sub-agent) +15 while active, Web tools 1.
   - Score = events-per-minute weighted, EMA with ~20 s half-life, scaled to 0–100.
2. **System load (secondary).** CPU and GPU utilization blended in at 30% weight (so local model runs and builds count).
3. **Transcript fallback (optional).** Tail the newest `~/.claude/projects/*/*.jsonl` for token usage to estimate output-token velocity. Verify the format on my machine first.
4. **Simulator** overrides everything while the dock is in Simulator mode.

`Stop` triggers a celebration and lets the score decay to idle.

---

## 7. Keyboard RGB bridge (Dell G15 5530, 4 zones)

Pick the driver after the Phase 0 hardware check:
1. **OpenRGB SDK** (`openrgb-python`, `127.0.0.1:6742`) if OpenRGB detects the keyboard.
2. **Dell G15 direct driver** (HID `187c:0551` via `hidapi`, protocol based on existing open-source Linux G15 lighting tools; credit them in the README) if OpenRGB doesn't.
3. **Mock** driver: the 4-zone virtual strip in the dock. Always available.

Rules:
- HSV lerp between colours. Effect math runs at 60 Hz internally, but **hardware writes are throttled** to the safe rate measured in Phase 4 (start at 10 FPS, never more than 20 FPS) and skipped if the colour hasn't changed.
- **Before any high-rate writes, find out whether the controller stores each update in flash.** If it does, only write on mood changes and use the keyboard's built-in breathing/pulse effects instead of streaming frames.
- On exit, restore the keyboard to the colour it had before the app started.
- Ship a udev rule file (`packaging/99-claude-bot-g15.rules`) and document installing it.

---

## 8. Simulator dock (glass panel, hidden by default)
Opens from a small handle next to the badge or from the tray menu. It contains:
- Pressure slider 0–100
- Mood buttons (Idle, Light, Deep, Overdrive, Masti)
- Auto-demo loop
- Input source chips (Hooks / System / Simulator)
- **Move tester:** a button for each move in 3.4
- **Emote browser:** a grid of all 48 clean sprites. Clicking one plays it on the 3D octo.
- Telemetry override sliders (fake CPU/GPU temps) to test `melt`, `sick`, etc.
- The 4-zone virtual keyboard strip with effect name, hex and writes/s

Look: match `assets/reference/ui-preview.html`.

---

## 9. Tray and settings
Tray icon menu: Show/hide octo, Open dock, Masti, Sleep (pause everything), Click-through lock, Start on login, Quit.
`config.yaml`: thresholds, verb pools, emote mappings, HUD mode, outline on/off, octo size (S/M/L), RGB driver override, birthday.

---

## 10. Phased roadmap (small wins first)

| Phase | Deliverable I can see | Est. |
|---|---|---|
| 0 | Hardware and environment report (`docs/HARDWARE.md`): session type, RGB variant and USB id, OpenRGB detection, sensors available, NVML, dGPU runtime status, Claude Code version and hooks docs | 30 min |
| 1 | `clean_emotes.py` + contact sheet; **3D octo in a plain browser page** with orbit controls and buttons for idle, blink, turnAround, jump, roll | 2–3 days |
| 2 | Electron transparent overlay on Nobara: click-through by cursor polling, drag, clamping across monitors, persisted position | 1–2 days |
| 3 | Badge + mood system + simulator dock, all fake data; full motion library | 2–3 days |
| 4 | Bridge + mock RGB → real keyboard driver, throttle measured | 1–3 days |
| 5 | Telemetry HUD with real sensors (dGPU sleep-safe) | 1 day |
| 6 | Claude Code hooks → live pressure; context emotes | 1–2 days |
| 7 | Remaining props in voxel form, tray, autostart, packaging (AppImage or `.desktop` + systemd user service for the bridge) | 2–3 days |

## 11. Risks and fallbacks
- **XWayland transparency or click-through glitches** → log into a Plasma X11 session; or as a last resort make the octo a normal small window with click-through off.
- **Moving the window for walk/roll is janky** → use a full-width, short, click-through strip window along the bottom of the screen and move the octo inside it.
- **Keyboard is the white-only variant, or no driver works** → the virtual strip becomes the main RGB display; everything else is unaffected.
- **NVML keeps the dGPU awake** → poll the GPU only while it is already active, and only every 3 s on battery.
- **Hook event names differ in my Claude Code version** → adapt to the installed docs; transcript tailing is the fallback.
- **Voxel model doesn't look like the stickers** → keep the 2D clean sprite with fake-3D motion (flip, squash, roll as a 2D card) as the fallback renderer behind a setting.

## 12. Deliverables
1. The repo, with one-command setup: `./setup.sh` (dnf system deps, Python venv + `pip install -r requirements.txt`, `npm install`) and `./run.sh`.
2. Electron + React + three.js app as specified.
3. `bridge/` Python service with pressure engine, telemetry, RGB drivers, tests for the pressure maths and colour lerp.
4. `hooks/claude_hook.py` + a settings snippet and install instructions.
5. `tools/clean_emotes.py`, `voxels/octo.json`, `voxels/props/`.
6. README: setup on Nobara, udev rule, OpenRGB SDK server, hook install, troubleshooting (black window, click-through, keyboard not detected, dGPU not sleeping).
