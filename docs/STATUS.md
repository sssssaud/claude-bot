# Claude Bot: status

| Phase | State | Notes |
|---|---|---|
| 0 Hardware report | ✅ done 2026-11-20 | `docs/HARDWARE.md`. Read-only, nothing installed or written to hardware. |
| 1 clean_emotes + 3D octo in browser | ✅ done 2026-11-20 | Tag `phase-1-working`. |
| 2 Electron overlay | ✅ done 2026-11-20, hand-checked | Tag `phase-2-working`. |
| 3 Badge + moods + dock (fake data) | ✅ done 2026-11-20 (3a moods/face/badge · 3b dock · 3c moves, particles, gaze) | Tag `phase-3-working`. |
| 4 Bridge + Stats Popup + Controls | 🔨 4a done 2026-11-22 | Python aiohttp bridge on 127.0.0.1:8765, real telemetry (<0.9% CPU, dGPU safe check), click octo → popup with live stats, BT/Wi-Fi/brightness toggles, alert toasts. Next: 4b RGB keyboard & terminal position via KWin |
| 5 Telemetry HUD | — | Merged into popup per Saud's 2026-11-21 plan |
| 6 Hooks → live pressure | ✅ installed 2026-11-23 (Saud's OK); live: real hook events + real token usage reach the bridge | Backup `~/.claude/settings.json.bak-claude-bot-20261123-225236`; undo with `python3 hooks/install.py --uninstall` | Use `PostToolUseFailure` and `SubagentStart/Stop` (see HARDWARE.md) |
| 7 Props, tray, packaging | — | |

## Emotes on the big octo; sticker removed (Claude, 2026-11-23, `66c17f6`)

Saud: the small 2D sticker didn't match the big 3D octo, so all emotes now live on the octo itself.
- `EXPRESSIONS` in `ui/mood/mood.js`: each of the 48 emotes → eyes + mouth + extras (blush, tears,
  sweat, anger) + voxel props + particles. 18 props in `voxels/octo.json` (`prop.*`: sunglasses,
  glasses, VR visor, headband, ninja band, headphones, horns, halo, bulb, party/santa/wizard/chef/straw
  hat, sprout, antennae, mug, laptop); 6 new particles (music notes, ?, !, thinking dots, rain, snow).
- Order on the octo: dock pick / Claude Code reaction > hello, healing > temperature > the mood's pool
  (5 s every 8–15 s) > the mood's own face. While an expression shows, its particles replace the mood's.
- Test: every one of the 48 emotes uses only parts and particles that exist, and every prop is used.
- Checked by screenshots of 24 expressions (sample: `docs/img/expressions.png`); fixed what they showed:
  black glasses merged with the black eyes into blocks (now grey frames), white snow under the white
  outline became blobs (now drawn after the outline pass), zZz floating next to angry/cool faces.
- Test page: `npm run dev:web` then `http://127.0.0.1:5173/?emote=40_devil` holds one expression.

## Claude Code → live mood + token usage (Claude, 2026-11-23)

- `bridge/activity.py` (pure, 8 tests): hook events → pressure (Edit/Write 3, Bash 2, Read/Grep/Glob
  and web 1; score halves every 20 s; sub-agents +15 each; system load **added** up to 30 points.
  Averaging it in, as first written, capped Claude-only work at 70, so overdrive was unreachable:
  caught by a test) and reactions (Stop → 10_idea + jump, or 04_cool + flipJump after overdrive;
  failed tool → 08_confused, 3 in a row → 05_crying, Esc is not an error; risky Bash → 40_devil +
  peekTurn; web tools → 46_traveler; sub-agent → 44_magic; Notification → 07_surprised + jump).
- Bridge: `POST /event`, `POST /usage` (validated), live pressure broadcast at 1 Hz, `config.json`
  thresholds loaded with defaults (agy's file was never read before).
- Electron: `sim.feed()` applies live pressure without resetting masti, auto-masti or the sleep timer;
  dock slider / auto-demo win for 60 s; reactions show the sticker for 6 s and play the move.
- Popup token row (Session % · Week % · reset time, "not updated recently" after 15 min); toasts at
  80 % (⚠) and 95 % (🛑) per window, once per level until that window resets.
- `hooks/claude_hook.py`, `hooks/statusline.py`, `hooks/install.py` (see `hooks/README.md`); 13 tests.
- Checked live with the real bridge and the real scripts: hook 37 ms, exit 0; 12 edits → pressure 100;
  risky Bash → devil; Stop → cool; status line passed through unchanged; 82 % → ⚠ toast, 96 % → 🛑
  toast (placed below the octo, not over the popup); app idle 12.9 % of one core + bridge 0.4 %; dGPU
  asleep. Installer dry-run on the real settings: 8 events added, Mission Control's 3 hooks and
  ponytail's status line kept. **Installed 2026-11-23 22:52** after Saud's OK; within seconds this Claude Code session's own hooks and status line were reaching the bridge (`POST /event`, `POST /usage` → 200; session 86 %, week 10 %).
- `run.sh` fixed: the app relaunched itself, so the script saw it exit at once and its EXIT trap killed the bridge. It now passes `--ozone-platform` itself (no relaunch) and stops the bridge when the octo closes.

## Phase 4a review fixes (Claude, 2026-11-23)

agy built 4a (`99d4710`); reviewed against HANDOVER.md before continuing. Found and fixed:
- **Security:** `Origin: null` (any web page via a sandboxed iframe) was accepted, so a website
  could switch Wi-Fi/Bluetooth off. Now: browser Origins only from http(s)://127.0.0.1|localhost,
  Host header must be local (DNS rebinding). Electron and Node send no Origin (measured), so the app
  is unaffected. Test fails if the hole is reopened (mutation-checked).
- **Validation:** `{"enabled": "false"}` turned Bluetooth ON; `NaN` pressure became 100; emote names
  and durations unchecked. One validator per value type, HTTP 400 with a message.
- **Freezes:** bluetoothctl/nmcli/qdbus ran on the event loop (up to 2 s each). Now in a thread; the
  controls are re-read every 10 s so changes made in KDE show up.
- **Mood flicker:** a second mood engine in Python (`bridge/state.py`) ran its own idle clock; the
  1 Hz telemetry messages re-sent Electron's state, so the two fought. Removed it: Electron's
  simulator is the only mood source; the bridge sends commands (`/masti`, `/pressure`, `/look`,
  `/emote` → `{"type": "cmd"}`). Checked: 20 samples over 4 s, one state.
- **Honest controls:** a failed read showed made-up values (brightness 40 %); now `null` → popup
  shows `?` and disables the control. Popup control values validated in main.js; failures shown as
  a toast instead of being swallowed. Brightness minimum 5 % (0 can black out the panel).
- **Popup:** solid background (92 % alpha + backdrop blur let desktop text bleed through), badge and
  emote sticker hidden while it's open (they overlapped it), DOM written only while open and only
  when a value changed, Wi-Fi chip no longer wraps.
- Dock's fake temperatures win for 60 s after the last slider move, then real temps return.
- Checked live: mock bridge + app over DevTools: popup BT toggle and brightness reach the bridge,
  `/masti` and `/pressure` from curl reach the octo, null origin → 403, dGPU asleep.
- Tests: 24 node + 10 bridge + sprite self-check.

## Phase 4a: Python Bridge with real data, popup panel, quick controls (2026-11-22)

- `bridge/`: lightweight Python service (`aiohttp` on `127.0.0.1:8765`, WebSocket `/ws` @ 10 Hz state, @ 1 Hz telemetry; strictly rejects non-local origins).
- **Safe dGPU polling**: Reads `/sys/bus/pci/devices/0000:01:00.0/power/runtime_status` directly. If `suspended`, reports `asleep` (zZ) and touches NVML never. Only queries NVML when `active`. Tested: dGPU stays suspended throughout.
- **Direct sysfs telemetry (<0.9% CPU)**: Autodiscovers direct hwmon paths on startup (`coretemp` `temp1_input`, `alienware_wmi` `fan1_input`/`fan2_input`), eliminating slow 48 ms hwmon sweeps down to <0.9% single-core CPU.
- **Controls**: Bluetooth power read/set via `bluetoothctl`, Wi-Fi read/set via `nmcli`, display brightness read/set via KDE D-Bus (`org.kde.Solid.PowerManagement`).
- **Stats & Controls Popup**: Clicking the octo toggles a glass popup panel (CPU % & temp, RAM % & GB, GPU status/watts, Battery %, Fan RPM, BT/Wi-Fi toggles, brightness slider, Claude Code token stats placeholder).
- **X11 Input Shape for Popup**: Dynamically adds popup box to `octo:region` `extras` so clicks on the popup register while the rest of the window remains transparent and click-through.
- **Alert Toasts**: Floating notification toasts with 60s cooldown for high temperatures (CPU ≥ 90 °C, GPU ≥ 83 °C) or memory exhaustion (RAM ≥ 90 %).
- **Bridge fallback**: Electron main connects to `ws://127.0.0.1:8765/ws`; if bridge is offline, transparently falls back to internal simulator and shows offline status dot in popup.
- Tests: 11 pytest bridge tests pass; 24 node tests pass; `test_clean_emotes` passes (35 total tests).

## Phase 3c: the rest of the moves, particles, gaze (2026-11-20)

- `moves.js`: flipJump, peekTurn, tumble (ends with dizzy `@ @` eyes), walk (8-leg wave gait,
  waddle), shake, melt (squash to 0.6 and reform), sleep (sinks, `– –`, zZz), dance, wave (arm
  nub), bounce (drop landing), plus drag flail and an eased gaze (body ±25°, eyes up to ~1 voxel).
  13 moves in total; every one starts and ends at rest (tested), 24 node tests.
- `particles.js`: pixel-art sprites in the same WebGL pass (no extra compositor layers) with the
  sticker outline: zZz, sparks, sweat drops, steam, hearts, sparkles, embers, and the crimson aura
  ring. The `{ }` / `</>` glyphs are drawn after the outline pass (as anti-aliased text, then even
  as 1-px pixel glyphs, the white border swamped them into blobs; seen and fixed).
- Behaviour (companion): wave + `hello` sticker on start; peekTurn on a mood change with the face
  swapped mid-turn; tumble + `healing` sticker when overdrive cools down; dance every 6 s in masti;
  melt every 9 s while the GPU is over 83 °C; sleep after 5 quiet minutes; random idle fidgets
  (peekTurn, roll, walk) every 20–40 s. The simulator now gives one auto-masti burst per quiet
  stretch (it used to repeat every 33 s, so sleep could never happen).
- **Saud's gaze request:** the dock has a look-target map (click where the terminal is); the octo
  turns and looks there. Checked on the real desktop: target far left vs far right visibly turns
  the body and shifts the eyes. The real terminal position comes from the bridge (Phase 4).
- Checked: slow-motion frame strips of all new moves, particles per mood, gaze on the real desktop,
  dock drag-and-drop with no page errors (the drop deltas weren't exact because someone was moving
  the test octo at the same time; the drag path itself is unchanged from Phase 2's exact test),
  idle CPU 26.9 % of one core with zZz particles (unchanged), dGPU asleep, no GPU crashes.

## Phase 3b: simulator dock (2026-11-20)

- The simulator moved into Electron's main process: one shared state ({ p, masti, demo, temps,
  emote }) sent to the overlay and the dock at 10 Hz. In Phase 4 the bridge takes its place.
- **Click the badge** to open/close the dock (spec §8: a handle next to the badge). The overlay's
  click region is now the octo + the badge (several X11 input rectangles; `xinput_shape.py` takes
  `x y w h` groups per line).
- `ui/dock.*` (styled from the approved preview): pressure slider, mood buttons, auto-demo, input
  source chips, move tester, 48-emote browser (click = show it on the octo for 6 s), CPU/GPU
  temperature override, 4-zone keyboard strip with effect name, hex and writes/s (mock, 20/s).
- Temperatures (spec §3.6): CPU > 90 °C → `sick` sticker; GPU > 83 °C → sweat on the face; both
  < 45 °C while idle → `snowy`. Keyboard effects in `ui/mood/keyboard.js` (ported from the
  preview; the bridge drives the real keyboard in Phase 4). 4 new tests (22 total).
- Ctrl+Shift+M → masti via Electron's globalShortcut (under XWayland it only fires while an X11
  window has focus; the bridge's `POST /masti` + a KDE shortcut is the fallback, Phase 4).
- Frame cap: moves drew **119 FPS** on this 120 Hz panel; the gate now caps acting at 60 FPS
  (spec §3.3), tested at 60/120/144 Hz.
- Checked on the real app over DevTools: badge click opens and hides the dock; dock pressure,
  mood buttons, masti, emote picks, temperature sliders and move buttons all reach the overlay;
  keyboard strip at 20–21 writes/s; idle CPU with the dock hidden 26 % of one core (same as 3a);
  dGPU asleep. (A false alarm on the way: a `const` re-declared in the DevTools console silently
  skipped a test step, not an app bug.)

## Phase 3a: moods, face, badge, emote sticker (2026-11-20)

- `ui/mood/mood.js` (pure, 6 node tests): pressure → mood at the spec thresholds, verb pools and
  swap interval (4 s → 2.5 s), heat colour #E07A5F → #FF5500 → #FF1E00 / masti #FF0055 ↔ #FF758F,
  pose + face per mood, emote pools (8–15 s rotation), the preview's auto-demo loop, and a
  simulator with auto-masti after 25 s idle (8 s).
- Face: 15 decal parts in `octo.json` (eyes open/closed/sleepy/happy/angry/wink/heart/dead, mouths
  smile/o/grit/smirk, extras blush/tears/sweat/anger). Blush `#EF9B81` and heart `#F8363B` sampled
  from the sheet. Mood pose (bob, lean, tilt, bounce, shake) crossfades over 0.4 s (tested: no pop).
- `ui/companion.js`: the approved badge ported from `ui-preview.html` (star spinner, slot slide +
  blur fade, heat colours + glow, shimmer above 80 %, flips side near screen edges) and the emote
  sticker (clean sprite, white sticker border) above the octo's head. Local fonts (Sora,
  JetBrains Mono via Fontsource), nothing loaded from the internet.
- Overlay window 640×360 (room for the badge). Until the dock exists, the auto-demo drives it.
- Checked: each mood screenshotted (idle/light/deep/overdrive/masti), fonts loaded, no page errors,
  on the real desktop (cropped capture), dGPU suspended, 18 node tests pass.
- **CPU (one core, Electron total, mood held steady):** idle 24.6 %, light 28 %, deep 26 %,
  overdrive 31 %, masti 32 %; the octo alone at 640×360 is ~17 %. Found and fixed on the way
  (first build was 34–42 %): a CSS-animated spinner and colour transitions kept the compositor at
  60 FPS, and the badge re-anchored on every idle bob. Now the star turns in steps and all badge
  updates ride on the octo's own frames. Later lever: a narrower 3D canvas inside the window (~−3 %).
- Changed from the spec: **no React / Framer Motion.** The approved preview's badge is ~40 lines of
  plain DOM + CSS; React would add ~200 kB and per-frame work for no visible gain. Revisit if the
  dock gets complex. Idle emote pool uses 36_sprout instead of "30 sunny" (30 is a raincoat).

## Phase 2: what was built and checked

- `npm run app`: the octo floats on the desktop in a transparent, frameless, always-on-top window
  (460×340, mostly empty and click-through). Click the octo = turnAround; press and drag = move it.
- `app/main.js` relaunches itself with `--ozone-platform=x11`; `focusable: false` makes it an
  unmanaged X11 overlay that KWin keeps above other windows and out of the taskbar/Alt-Tab.
- Click-through: the window's X11 **input shape** is the octo's box (`app/xinput_shape.py`, stdlib
  ctypes; falls back to `setShape()`). Scene3D reports the box, snapped to 8 px.
- Position: saved as fractions of the work area + display id (`~/.config/claude-bot/position.json`);
  on drop and on display add/remove/metrics change the **octo** (not the empty window) is clamped
  into the nearest display. Maths in `app/placement.js`, 4 node tests.
- Checked on this machine: X11 window, override-redirect, ARGB; transparent on the real desktop
  (cropped screen capture); drawn over a file manager window; input shape = octo box; drag moved
  the window by exactly the pointer delta; dragging far off-screen clamped the octo into the corner;
  position saved and restored after a restart; WebGL on Intel; 61 FPS acting / 24 FPS idle;
  idle CPU 13.7 % of one core; dGPU suspended throughout; no GPU crashes.
- **Checked by hand (Saud, 15:25):** real-mouse drag and drop worked (it saved `position.json`
  at 15:25:32); click-through next to the octo and click-to-spin confirmed by Saud. Normal launch
  went through the self-relaunch, no crashes, dGPU stayed suspended.

## Phase 1: what was built and checked

- `tools/clean_emotes.py` cuts the 48 stickers from `sheets/sheet_48_emotes.png` →
  `assets/emotes-clean/NN_name.png` (27–37 px wide) + `contact_sheet.png`, 31 colours, ~1 s.
  Self-check `tools/test_clean_emotes.py` passes and fails on two planted bugs (shallow border
  peel, wrong row grouping).
- `voxels/octo.json`: 420 voxels (body 12×9×4 with chamfered back slice, 2 arm nubs, 4 front +
  4 back legs, open/closed eye decals). Orange `#F87A4B` and leg shade `#D2562F` come from the clean sprites.
- `npm run dev:web`: the octo on a transparent canvas, with buttons for idle, blink, turnAround,
  jump and roll, an outline toggle, orbit drag, and `?speed=0.1` slow motion. 14 draw calls.
- `npm test`: 7 node tests (model parse + voxel budget, palette error, face culling, every move
  starts/ends at rest, volume-preserving squash, 24 FPS idle gate at 60/144 Hz, player queue/interrupt/roll).
- Checked in a headless browser frame by frame (slow motion): jump squash → stretch → air →
  land squash → overshoot → settle; turnAround shows the side and plain back; roll lands in
  view; blink closes the eyes; outline toggles; back view clean; no console errors.

## Verified facts
- Wayland KDE Plasma 6.7.5. XWayland GL renderer = Intel iGPU.
- Keyboard `187c:0551` AW-ELC on `/dev/hidraw0`. User already has rw. OpenRGB 1.0 sees 4 zones.
- dGPU suspends when idle. `lspci` wakes it. sysfs driver listing and alienware_wmi reads don't.
- The emote art has **no consistent pixel grid** (autocorrelation periods 5–23 px, differing per
  sticker), so sprites use a fixed 5 px block instead of grid detection.
- Headless Chrome here renders with SwiftShader (CPU) at ~18 rAF/s, so it can't measure real FPS.

## Changes from the spec (and why)
1. **Sprites come from the sheet, not the 256 px crops.** The crops are blurry and mis-framed.
2. **Emote names follow the art:** `17_workout`, `30_raincoat`, `37_cloud` (the old names didn't
   match). Proper headset/sun/spa poses exist only on the 86-emote sheet: cut them in Phase 3 if wanted.
3. **Sticker outline is a screen-space pass, not an inverted hull.** On voxels, a hull pokes out
   of the front face and drew white lines on every row seam. The new pass gives a uniform,
   outside-only border in any pose and is still a toggle.
4. **Merged exposed-face meshes, not one InstancedMesh per material.** Full cubes z-fight along
   buried faces (lit lines flickered on the back), and parts must move on their own anyway.
5. **Click-through by the window's input shape, not by polling the cursor.** Under XWayland an X11
   app doesn't see the cursor while it is over native Wayland windows, so `getCursorScreenPoint()`
   polling can't detect a hover. The compositor routes clicks by the input shape instead.
6. **Relaunch with `--ozone-platform=x11` instead of `appendSwitch`** (too late; caused GPU crashes).
7. **Position is clamped by the octo's box, not the window's**, so the octo can sit flush against
   any screen edge while the empty part of the window hangs off-screen.

## Saud's additions (2026-11-20)
1. **Eyes always look at the terminal** (replaces the spec's cursor `lookAt`). ✅ Phase 3c:
   "look at a screen point" (eyes shift, body yaws up to ±25°) driven by a fake terminal position
   from the dock. Phase 4: the bridge finds the real terminal. Wayland apps can't see other windows,
   so a small KWin script reports the window of the terminal that runs Claude Code (its process →
   KWin window `pid`), over D-Bus.
2. **Click the octo → popup panel** (click, not hover; Saud 2026-11-21, replaces the spec's
   always-visible HUD and the old "future upgrade" note): CPU / GPU / RAM usage and temperature,
   battery %, Bluetooth and Wi-Fi on/off, brightness slider, and **Claude Code token usage**
   (5-hour session % and weekly %, with reset times).
3. **Alert toasts** that pop up for a few seconds: token usage at 80 % (and 95 %), CPU/GPU too hot,
   RAM nearly full.
4. **Later, "beauty" pass:** the mood indicator (verb badge, emote sticker) moves into the popup so
   the octo looks clean from outside. Rule from Saud: **make it alive first, then make it pretty.**

Feasibility, checked 2026-11-21 on this laptop (no root needed for any of it):
- Token usage: Claude Code 2.1.330 computes `five_hour` and `seven_day` `used_percentage` +
  `resets_at` and `context_window.used_percentage` for its status line input. The status line is
  already set to ponytail's script, so ours must **wrap it** (both keep working), not replace it.
  Caveats: subscription logins only; the numbers refresh when Claude Code redraws its status line.
- Brightness: KDE D-Bus (`org.kde.ScreenBrightness`, PowerDevil BrightnessControl). The sysfs
  backlight is not writable without root, so not that.
- Bluetooth: `bluetoothctl` (adapter powered). Wi-Fi: `nmcli`. Battery: `upower` / psutil.
- GPU numbers only while the RTX 3050 is awake; when asleep the popup says so (reading it wakes it).

## Saud's vision: what the bot is for (2026-11-23)

The point of the bot: **show what each Claude Code session is doing**, so terminals can stay minimised.

1. **One octo per running session.** Each session spawns its own octo, labelled with its project folder;
   the octo shows what that session is doing (editing, running Bash, waiting, done). Session ends → its
   octo leaves. Feasible: every hook payload has `session_id` and `cwd` (checked in 2.1.330); the hook
   must start sending `session_id` + the folder name (not the full path), and SessionStart/SessionEnd
   need hooking too.
2. **Future: attention.** For users without auto-permission, the octo comes to the cursor when its session
   needs a permission (`PermissionRequest` hook: tool_name, tool_input); when work is done it roams the
   screen or comes to the cursor. Cursor position under Wayland: KWin script (`workspace.cursorPos`),
   because X11 apps can't see the cursor over Wayland windows. Answering stays in the terminal for now
   (Allow/Deny buttons on a floating window = one stray click runs a command; decide later).
3. **Future: voice → text only.** The user speaks, it types. Local `whisper-cli` (whisper.cpp, CPU; already
   installed). Typing into the terminal needs `wl-clipboard` or `ydotool` (dnf, later).
   **The bot never speaks** (no text-to-speech): it would read everything, not what matters, and what
   matters is for the developer/user to decide.

## Constraints
- **No Plasma X11 session** on this laptop (it doesn't work, per Saud). The spec's "log into a Plasma
  X11 session" fallback (PROMPT.md §11) is out. The overlay runs in the Wayland session through
  XWayland; fallbacks are `CLAUDE_BOT_OZONE=wayland` or a full-width bottom-strip window.

## Blockers / open questions
- Screen-lock pause (spec 3.3) not done yet: Phase 7, together with the tray's Sleep.
- `lookAt` (Phase 3) needs the cursor position, which XWayland only reports over X11 windows: expect it to work only near the octo.
- Does the AW-ELC store each update in flash? (Phase 4, before any streaming)
- Blush colour for the face: not sampled yet (the clean sprites lose the tiny cheeks). Phase 3 expressions.
- Project path has a space in a parent folder (`Projects/claude bot/claude-bot`). Fine so far.
