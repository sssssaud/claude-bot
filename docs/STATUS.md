# Claude Bot: status

| Phase | State | Notes |
|---|---|---|
| 0 Hardware report | ✅ done 2026-11-20 | `docs/HARDWARE.md`. Read-only, nothing installed or written to hardware. |
| 1 clean_emotes + 3D octo in browser | ✅ done 2026-11-20 | Tag `phase-1-working`. |
| 2 Electron overlay | ✅ done 2026-11-20, hand-checked | Tag `phase-2-working`. |
| 3 Badge + moods + dock (fake data) | 🔨 3a ✅ (moods, face, badge, sticker) · 3b dock next · 3c moves | |
| 4 Bridge + RGB | — | Tier 1 OpenRGB SDK is viable (see HARDWARE.md) |
| 5 Telemetry HUD | — | Never `lspci` in the poll loop (it wakes the dGPU) |
| 6 Hooks → live pressure | — | Use `PostToolUseFailure` and `SubagentStart/Stop` (see HARDWARE.md) |
| 7 Props, tray, packaging | — | |

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
1. **Eyes always look at the terminal** (replaces the spec's cursor `lookAt`). Phase 3 builds
   "look at a screen point" (eyes shift, body yaws up to ±25°) driven by a fake terminal position
   from the dock. Phase 4: the bridge finds the real terminal. Wayland apps can't see other windows,
   so a small KWin script reports the window of the terminal that runs Claude Code (its process →
   KWin window `pid`), over D-Bus.
2. **Future upgrade, not scheduled yet:** click the octo → quick-settings popup to control
   Bluetooth, Wi-Fi, brightness and show battery %. Through the bridge: BlueZ and NetworkManager
   D-Bus, UPower/psutil, KDE PowerDevil brightness. (Click currently = turnAround.)

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
