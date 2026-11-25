# Claude Bot: status

| Phase | State | Notes |
|---|---|---|
| 0 Hardware report | ✅ done 2026-11-20 | `docs/HARDWARE.md`. Read-only, nothing installed or written to hardware. |
| 1 clean_emotes + 3D octo in browser | ✅ done 2026-11-20 | Tag `phase-1-working`. |
| 2 Electron overlay | ✅ done 2026-11-20, hand-checked | Tag `phase-2-working`. |
| 3 Badge + moods + dock (fake data) | ✅ done 2026-11-20 (3a moods/face/badge · 3b dock · 3c moves, particles, gaze) | Tag `phase-3-working`. |
| 4 Bridge + Stats Popup + Controls | ✅ (keyboard RGB removed 2026-11-24) | Python aiohttp bridge on 127.0.0.1:8765, real telemetry (<0.9% CPU, dGPU safe check), click octo → popup with live stats, BT/Wi-Fi/brightness toggles, alert toasts. Terminal position via KWin ✅ 2026-11-24. |
| 5 Telemetry HUD | — | Merged into popup per Saud's 2026-11-21 plan |
| 6 Hooks → live pressure | ✅ installed 2026-11-23 (Saud's OK); live: real hook events + real token usage reach the bridge | Backup `~/.claude/settings.json.bak-claude-bot-20261123-225236`; undo with `python3 hooks/install.py --uninstall` | Use `PostToolUseFailure` and `SubagentStart/Stop` (see HARDWARE.md) |
| 7 Props, tray, packaging | 🔨 tray + Quit + start on login + single instance ✅ 2026-11-24; one-command setup left | |

## Energy + happiness pop up when a task is done (Claude, 2026-11-25)
Saud: take energy/happiness out of the popup; they should pop up when work is done (read as: a card on "done").
The click popup no longer has them. main.js `attend()` sends `octo:done` with the session's feelings from that same
live update (the 10 Hz renderer state is older: the first version showed the pre-finish numbers, 72 "fixed it
after errors" instead of 80 "finished a task"); the overlay shows a small "✓ Task done" card (same 4 tokens) beside
the octo for 6 s, not while the popup is open, not when Feelings is off. Placement shared with the popup
(`beside()`). Live: fake session errors → fix → Stop → card "Energy 70 · Happiness 80 · finished a task", gone
after 6 s; popup without Energy/Happiness.

## "GPU 0 % while gaming" is not a bug (Claude, 2026-11-25)
Saud's popup showed GPU 0 %, 4.3 W, 46 °C while GTA V ran. Evidence: GTA5.exe (wine) runs on the RTX (nvidia-smi:
58 %, 63 W, P0, 4.2 GB VRAM); the bridge vs nvidia-smi side by side, 5 samples: equal (56–62 %, ~64 W). GTA V's
settings.xml has `PauseOnFocusLoss value="1"`: switching away (to click the octo, take a screenshot) pauses the
game → GPU idle. No code change.

## No session → no octo; a new session starts the bot (Claude, 2026-11-25)
Saud: "same bug again: the bot stays after closing the session, a new one comes; a second session got no bot".
Evidence: only one Claude process was running (this conversation, resumed); the other sessions last wrote at
19:35–19:36, the bot was started at 19:38 after a reboot → they reached no bot. "A new one comes" = the spare
idle home octo `syncOctos` showed whenever there were zero sessions. Fixes: (1) with a bridge connected the
octos are exactly the sessions (zero → none); the home octo only without any bridge (`npm run app`); (2) the hook,
on SessionStart with the bridge refusing, starts `run.sh` in its own process session and a helper (`--deliver`)
re-sends that SessionStart until the bridge answers (≤ 30 s). Saud hadn't picked between Start on login and
auto-start; auto-start was the suggested one, taken as the default (Start on login stays his tray choice).
Quit from the tray lasts until the next session opens. Live: bot stopped → fake SessionStart through the hook
(0.04 s) → bridge up in 0.6 s, its octo shown, app in its own session; all sessions ended → 0 octo windows.

## Octo leaves when its terminal is closed (Claude, 2026-11-25)
Saud: an octo stayed on screen after closing. Closing a terminal window can kill Claude Code before it sends
SessionEnd, so the bridge kept the session until STALE_S (30 min). Now the bridge records each session's Claude
Code process (`owner_pid`: first hook ancestor that isn't a shell) and, every second, `Sessions.end_gone(running)`
ends sessions whose process is gone (a zombie counts as gone). Unknown owner → as before (SessionEnd / stale).
Tests: end_gone, owner_pid (dead + shell skipped), running (zombie). Live: fake session owned by a `sleep`; killed
→ session gone within 3 s, log "its Claude Code process is gone, octo leaves". (First live try didn't end: the
fake owner was a bash subshell, which owner_pid skips by design.) This session's real chain bash → claude →
bash → kitty → owner = claude.

## No octo for a new session: the app wasn't running (Claude, 2026-11-25)
Saud opened a session (alien language project); no octo. Evidence: no Electron, bridge down; hooks installed
(11 entries), no project override. Cause: Claude started `./run.sh` as a background job of its own Claude Code
session, so it died when that session's process ended. Fix now: started detached (`setsid -f ./run.sh`, log
`~/.cache/claude-bot.log`, own process session). Rule for agents: never start the app as a Claude Code
background job; use setsid. An already-open session gets its octo on its next hook event (bridge memory starts
empty). Lasting fix: done (a new session starts the bot, see "No session → no octo"); Start on login stays optional.

## `./setup.sh` ✅ one-command setup (Claude, 2026-11-25)
Steps: system check (python3 ≥ 3.10, node ≥ 22.12 for Electron 45, curl, qdbus, dbus-monitor, bluetoothctl,
nmcli, python3-dbus + python3-gobject-base for app/kwin.py; missing → prints `sudo dnf install /usr/bin/<tool> …`
(dnf resolves the package by file, right on any release) and stops, never runs sudo) → `.venv` + requirements →
`npm install` + Electron binary → build → `npm run test:all` → asks before `python3 hooks/install.py` (skipped
without a terminal). Idempotent: re-run in the real repo → all "ok", git status unchanged.
**Found by the fresh-clone test:** Electron 45 has no install script (binary downloads on first `require`), and
run.sh starts the binary directly → a fresh machine would fail. Now setup.sh and run.sh both run Electron's
`install.js` when the binary is missing. Verified: fresh clone in a path with a space → setup exit 0 (Electron
45.4.1, 28 + 63 tests) → its `./run.sh` started the octos (bridge up, 0 error lines). Missing-tool path tested
with a made-up tool name (prints the dnf line, exit 1).
Lesson: don't test "missing tools" by stripping PATH under Claude Code's shell wrapper: its snapshot re-spawned
bash in a chain (1,731 shells; collapsed on its own, nothing lost). Use a made-up tool name instead.

## Phase C ✅ energy + happiness (Claude, 2026-11-25)
`bridge/feelings.py` (pure): each session's octo has energy + happiness, 0–100, drifting back to 70 (half-life
15 min). Events: error −4 happiness (3rd+ in a row −8), fixed after errors +10, finished +8 (10+ min task also −6
energy). Per minute: overdrive −3 energy, working after midnight–5 am −2 (more in overdrive), idle +3 energy,
permission waiting 60 s+ −2 happiness. `why` = latest reason; an event's reason stays 2 min before a situation's
replaces it (test caught "working hard" wiping "fixed it after errors" within a second). `live()` ticks it every
second (server passes the local hour) and sends `feel`. Octo: energy < 35 → drained pose + coffee/low-battery
pool; happiness < 35 → rainy/thinking pool; > 85 → extra laughing/hug (`mood.js feelingPools`, bends the
personality's pools). Popup: Energy / Happiness bars (accent under 35) + reason; hidden without a session.
Tray "Feelings" switch (off = no effect, no bars). Also: tool events with no known turn (bridge restarted
mid-turn) now count as a running turn (it said "resting" while Claude worked).
Checked live: fake session, 6 errors → popup Energy 70 / Happiness 30 (orange) "6 errors in a row"; tray menu
read over D-Bus shows Feelings ✓.

## Phase B ✅ personalities (Claude, 2026-11-25)
`mood.js PERSONALITIES`: one table each. **Friendly** (default): errors → thinking / strong, done → hug, overdrive
pool strong/lifting/cycling (never angry). **Dramatic**: first error → crying, done → party (birthday), jump →
flipJump, bounce → tumble; idle pool cozy/cloud/rainy, overdrive angry/lifting/crying; pool faces, moments and
fidgets come back faster (×0.6 / ×0.5 / ×0.5). **Calm**: errors → thinking, risky → surprised, web/sub-agent/relief
reactions off, big moves → bounce or none; one quiet emote per mood; ×2.5 / ×3 / ×3 slower. Needs-you and done
stay in every personality. `restyle()` in main.js applies it to each Claude Code reaction; the renderer uses
the pools, timing and moment moves. Picked from the tray (radio submenu "Personality") or the dock (same saved
pref, `prefs.json personality`). Checked live: same 3-errors moment → Friendly strong (happy, smirk, sweat),
Dramatic crying + tumble, Calm thinking (…); tray menu read over D-Bus shows the radio items.

## Phase A ✅ session moments (Claude, 2026-11-25)
`bridge/sessions.py` reports each session's situations in priority order (`live(...)["moments"]`):
waiting_long (permission unanswered ≥ 60 s) · context_full (≥ 85 %, per session: status line now sends
session_id, `/usage` stores it via `set_context`) · long_turn (≥ 10 min of Claude's own working time per
prompt; time waiting for Saud subtracted) · juggling (≥ 2 sub-agents) · limit_near (5-hour or weekly ≥ 80 %).
`activity.py`: relief reaction `22_healing` + jump when a tool works after ≥ 2 errors in a row.
Octo (Friendly look, `mood.js MOMENTS`): impatient (angry eyes, no mouth, dots, shake) · dizzy-full (dizzy,
o, blush, bounce) · tired (sleepy, grit, sweat) · juggling (happy, grit, sweat, sparkles) · worried (open, grit,
sweat); none equals one of the 48 emotes (test). `momentPicker`: one at a time, MOMENT_S = 8 s, then rests
20–120 s while it lasts; starts only when no reaction/greeting is on screen (live test showed a moment used up
unseen behind the sub-agent reaction → fixed). Priority on the face: reaction > greeting > moment > temp/battery.
Checked live (fake session, screenshots): juggling, dizzy-full, impatient + badge "Needs you: <what>".
long_turn / limit_near: tests only (10 min; fake limits would show in the popup).

## Personality + session moments + feelings: Saud picked option 3 (2026-11-25), plan approved, A done
Plan: A) bridge computes each session's moments (pure, tested; status line also sends session_id so context
fullness is per session) → B) 3 personalities in the renderer (tables; tray + dock picker; default Friendly,
assumed) → C) energy + happiness per session in the bridge, shown in the popup and in pose/face.
Each phase: tests, live screenshots, commit. Risks: too busy (cooldowns, Calm), wrong detection (only count
Claude's working time; tests), feelings feel random (popup shows the meters and why).

## Idea waiting for Saud's pick: session-true expressions + personality (2026-11-25)
Saud: each octo's face should match its session (heavy session → that kind of face), and the octo should have
a customisable personality ("friendly or other type") and its own emotions. Ideas only, not built.
Today: pressure → mood (idle ≤ 15 · light ≤ 45 · deep ≤ 75 · overdrive) with pose + face pool per mood;
events → reactions (error → confused, 3 in a row → crying; risky → devil; web → traveler; sub-agent → magic;
needs you → surprised; done → cool/idea); context: hot CPU sick, battery, cold snowy.
New session signals available (all from data we already get): turn running long (10+ min); waiting on a
permission for a while; fixed after errors (relief); context window nearly full (status line has session_id →
per session); token limit near (80/95 %); many sub-agents at once; idle for long.
Personalities = one table each (mood pools + reaction table + how often/how big): **Friendly** (default:
encouraging, errors → thinking/strong, done → hug/love), **Dramatic** (big: errors → crying fast, overdrive →
angry, done → party flip), **Calm** (few emotes, slow, own face mostly; good for focus / screen sharing).
Picked from the tray (global) + optional per-project override in config.json.
Options: (1) personalities only; (2) personalities + the new signals (recommended); (3) + inner emotions:
energy and happiness meters that drift through the day (errors/long nights lower, wins/breaks raise).

## New sessions no longer blank the token limits (Claude, 2026-11-25)
Saud opened two sessions → popup Session/Week "–", "resets ?". Cause: a freshly opened session's status line has
no `rate_limits` yet (context % only); `/usage` **replaced** the whole stored record, so the account's limits
vanished until an older session redrew its status line (flickering). Fix in `handle_usage` (every sender goes
through it): keep the last five_hour/seven_day and their `received_at` when a payload lacks them; drop a window
whose `resets_at` has passed. Popup: "waiting for Claude Code" when no limits at all. Test reproduced it first
(KeyError five_hour), then passes. **Why the popup can read 1 % under `/usage` (Saud, 2026-11-25: 47/31 vs
48/32):** not staleness (bridge's limits were 3 s old and still 47.0/31.0 a minute after /usage said 48/32) and
not us (hook passes the number through, bridge keeps decimals). Claude Code's status line gets the limits from the
last API response (docs: code.claude.com/docs/en/statusline, "rate_limits … appears only after the first API
response"); it sent whole numbers here, while `/usage` reads them separately with its own rounding. Don't add +1. Live: real 46 %/31 % arrived, a context-only post (what a new session sends)
→ still 46 %/31 %, same time stamp.

## Popup redesign: minimal and clean (Claude, 2026-11-25)
Saud: brightness bar sticks out; wants a minimalist, clean popup. Ranked critique of the old one (measured):
1) brightness row overflowed by 59 px (two chips + a range input that can't shrink below ~129 px, one flex row);
2) placed above the octo when there's no room below → covered its head (~41 px); 3) noise: 3 divider styles,
tinted GPU pill, glowing dot, salmon border, ALL-CAPS abbreviations, 6 text colours; 4) Sora / JetBrains Mono
not installed (fc-match → Noto Sans): unintended fallback fonts; 5) small grey text 3.8:1 (fails WCAG AA).
**Locked tokens:** canvas #121014 · surface #1D1A20 · ink #F1ECE8 · accent #FF7A45 (octo orange: only "on",
slider fill, usage ≥ 80 %); muted = ink 62 % → 6.7:1, ink 16.1:1, accent 7.3:1. Type: Inter only (installed),
tabular numbers. Motion: cubic-bezier(.32,.72,0,1), open = fade + 6 px rise; reduced motion respected.
Layout (236 px): header (bridge dot, title, close) · 2×2 grid CPU/RAM/GPU/Battery with one muted detail line
each (fan rpm moved under CPU) · Bluetooth / Wi-Fi toggles (On/Off/?, aria-pressed) · brightness on its own row
(min-width 0, accent fill via --v) · Session/Week thin bars + reset time. Placement: beside the octo on the
roomier side (may slide over its side in a tight window, never its head); above/below only if neither side has
¾ of the popup's width. (First try fell back to above: the octo's real box is ~230 px wide, not the nominal 176,
left side 1 px short → rule changed, not the gap.)
Checked live via screenshots: overflow 59 px → none; popup beside the octo, octo fully visible; slider sends and
fills (44 % → fill 41 %); toggles report state.

## Brightness follows the slider live (Claude, 2026-11-25)
Saud: brightness only changed on release. The slider now sends on every `input`; main.js `setControl` runs one
request per control at a time and keeps only the newest waiting value (a set takes 0.07–0.12 s, measured), so
nothing piles up. Checked live (simulated 1.5 s drag 44 → 30 → 44, KDE's real brightness sampled every 0.1 s):
44, 40, 34, 31, 30, 32, 38, 44 %; 30 slider moves → 12 bridge requests; ended at 44 %.

## Octo says what's happening in Claude's words: option 2 (Claude, 2026-11-25)
Saud asked why the octo's text differs from the terminal's. Terminal spinner words ("Pondering…") are never given
to hooks; commands/paths were deliberately not sent (privacy). Option 2 (his pick): the hook now also sends a
`detail`: Claude's one-line `description` of a Bash command / sub-agent, or a file's NAME (Read/Edit/Write…);
every word with "/" → its last part; dropped if it looks like a secret (`sk-`, `ghp_`, AKIA, 32+ random chars,
`password:`/`token=`…); max 60 chars. Searches and web queries stay generic. Bridge validates it (`DETAIL`, no
control chars, ≤ 60); `sessions.py detail_for`: "Run all tests", "Editing main.js", "Agent: …", and on a permission
request "Needs you: <what>" (kept through the echo notification). App: tray **Show details** (on by default;
off = generic labels, e.g. for screen sharing); badge text capped at 30ch with "…".
Checked live: this session's own command summaries on its octo's badge (screenshot); a first try cut text at
111 px (the grid item stretched to the old width) → `justify-self: start` → 340 px + "…". Tests: hook (summary/file
name only, secrets/paths/search text dropped), sessions (detail + echo), bridge (bad details → 400).

## "Done" walk only when the terminal isn't in front (Claude, 2026-11-25)
`app/kwin.py`'s window answer now has `active` (`best === workspace.activeWindow`, Plasma 6). In `comeOver`, a
**done** session whose terminal is active and not minimised gets its flipJump in place (log: "<project>: done,
its terminal is in front: reacting in place"); otherwise it walks over as before. Permission requests always come.
Checked live: KWin answers active=true for a just-opened test window, active=false once minimised, true for
this session's kitty; fake session A (pids = this kitty, in front) → logged "reacting in place"; fake session B
(minimised test window) → no such line, walked over.

## Low-battery reaction (Claude, 2026-11-25)
Spec 3.6 row "Battery under 20 %, unplugged → 23 low_battery, sleep-ish droop". `ui/mood/mood.js`: `lowBattery(b)`
(unplugged and < 20 %; no reading = no reaction) and `contextEmote(temps, battery, mood)` (was `tempEmote`):
hot CPU > low battery > snowy. New pose `POSE.drained` (slow, small bob, head down) replaces the mood's pose while
low; Claude Code reactions still win for their 6 s; the badge keeps showing what the session is doing.
Dock "Telemetry override" got a **Battery** slider (unplugged, same 60 s window as the CPU/GPU sliders).
**Checked live 2026-11-25** on the running app (driven over a temporary local debugging port, screenshots
at 100 % vs 15 %): sleepy eyes, no mouth, body lower/head down at 15 %; normal at 100 %. Tests: 6 new asserts
in `mood.test.mjs`.
**Full battery (Saud: "solve those too", 2026-11-25):** spec row "Plugged in and full → 24 full_battery, small hop".
`fullBatteryWatch()` in mood.js: fires once when a plugged-in battery reaches 99 % (some never report 100), re-arms
only after unplugging or < 95 % (no repeat while trickling 99 ↔ 100; no hop at app start if already full) →
5 s `24_full_battery` + `jump`. Dock Battery slider: 100 = plugged in. Checked live: screenshots mid-hop (in the
air, ^ ^ eyes, smile, sparkle) and 2 s later (landed, sparkles).
**Battery reader fixed:** `get_battery` returned a made-up 100 %/plugged when psutil failed or there's no battery
(swallowed exception). Now: `None` (no battery / unreadable, logged once), `plugged: None` when the OS can't
tell (so "unknown" never counts as "unplugged" → no false droop); popup shows "?". Test in test_telemetry.py.

## Screen-lock pause (Claude, 2026-11-25)
Spec 3.3 ("pause when the screen is locked"). `app/screenlock.js` runs `dbus-monitor` on KDE's
`org.freedesktop.ScreenSaver.ActiveChanged(bool)` (flushes per message even into a pipe: checked with a harmless
test signal on a made-up interface). Locked → every octo hides (same path as tray Hide; Saud's saved Hide pref
untouched); unlocked → back in place; a session still waiting for permission → its octo comes to the cursor
then (not tested live: no permission request happened during the test). Watcher dies → `onChange(false)`, octos
never stay lost. Test: `app/screenlock.test.mjs` (parser, real captured output).
**Measured live (Saud pressed Meta+L, 2026-11-25), whole app, % of one core:** before 28.2 % (28 samples) →
locked **1.4 %** (41 samples, 0.3–5.0) → after 28.4 %. Log: "screen locked: octos hidden" / "screen unlocked: octos back".

## Tray, Quit, start on login (Claude, 2026-11-24)

- Tray icon (KDE system tray, StatusNotifierItem; icon = the octo's front view rendered from
  `voxels/octo.json`, `app/icon.png`). Menu: Hide/Show octos (left click toggles too), Simulator dock,
  Masti, Come to my cursor (on/off), Start on login, Quit Claude Bot.
- Hide/Show and Come-to-cursor are remembered in `~/.config/claude-bot/prefs.json` (bad file = defaults,
  logged). Hidden octos don't draw: **0.4 % of a core** in total (shown: ~9 % per octo).
- Start on login writes/removes `~/.config/autostart/claude-bot.desktop` → `bash ".../run.sh"` (Electron's
  setLoginItemSettings does nothing on Linux). The folder path is checked before it goes into the Exec
  line; `desktop-file-validate` passes. Left **off**: Saud's choice.
- Quit stops everything: app, cursor + click-through helpers, and the bridge `run.sh` started.
- Single-instance lock: a second launch (autostart + manual `run.sh`) exits in ~80 ms.
- Tested by clicking the real tray menu over D-Bus (`com.canonical.dbusmenu`, what Plasma does): every item.
  Found and fixed: unticking "Come to my cursor" saved correctly but the menu kept showing a tick.
  A first quick CPU reading said hidden = 7.8 %; that script lost processes mid-measurement; the
  per-process measurement says 0.4 %.

## Attention: the octo comes to the cursor (Claude, 2026-11-24)

Saud's step 2: when a session needs permission, or finishes, its octo comes to the user.
- **Cursor under Wayland:** `app/cursor.py` (system python3: dbus-python + PyGObject, already installed)
  owns `org.claudebot.Cursor` on the session bus; per question it loads a one-line KWin script that
  calls back with `workspace.cursorPos`, then unloads it. On demand only (≈ 23 ms), no tracking.
  Found on the way: KWin's `loadScript` has a 1- and a 2-argument version; dbus-python needs `signature="ss"`.
- **Bridge** (`sessions.py`, 3 new tests): `PermissionRequest` (and the `permission_prompt` notification
  that echoes it) → attention `permission` until the session's next real action (answered either way);
  `Stop` → attention `done` for 8 s; a new prompt ends it early; every permission request is a new episode
  (a test caught that a second request after a dismissed one didn't call the octo back). Each episode has
  an id. The hook now sends the notification **type** (never its message) and is registered for
  PermissionRequest; it prints nothing, so it can never answer a permission (tested: empty stdout).
- **Electron:** new episode → ask the cursor → glide the window (0.7 s, eased, legs flailing) to just
  right of the cursor (several waiting octos line up), jump (flipJump when done). Goes home when the
  episode ends, or when clicked ("seen it"); a drag makes the new spot home. No cursor → reacts in place.
- `config.json` → `"attention": {"come_for_permission": true, "come_when_done": true}` to switch either off.
- Checked live (real bridge, fake sessions through the real hook script, real cursor): permission → came
  from (1416, 704) to beside the cursor, waited, went home when answered; done → came over, home after 8 s
  (`docs/img/attention-done.png`); click → home; two sessions → lined up side by side. Installer re-run
  (backup `settings.json.bak-claude-bot-20261124-195428`); helper, KWin script and temp file all cleaned up.
- Not yet: knowing whether the session's terminal is already in front (then it needn't come); fractional
  display scaling untested (this laptop runs at 100 %).

## One octo per Claude Code session (Claude, 2026-11-24)

Saud's purpose for the bot, built: every running Claude Code session gets its own octo, labelled with its
project folder, saying what that session is doing, so terminals can stay minimised.
- `bridge/sessions.py` (pure, 5 tests): one activity engine per `session_id`; label = folder name (two
  sessions in one folder → `claude-bot #2`); "doing": *Thinking / Editing / Running a command / Reading
  code / Searching the web / Starting a sub-agent / Needs you / Hit an error / Done*; SessionEnd removes it,
  30 idle minutes removes a crashed one, at most 6 (least recently active goes).
- Hook sends `session` and `project` (the folder's **name**, never the path; tested), plus SessionStart and
  SessionEnd (installer re-run with backup `settings.json.bak-claude-bot-20261124-194443`).
- Bridge broadcasts `{"type": "live", "sessions": [...]}` at 1 Hz; reactions carry their session id so only
  that octo jumps/frowns.
- Electron: one transparent window per session, each with its own mood simulator, input shape and saved spot
  (per project folder, only when dragged); new octos line up 250 px apart; a session's end = wave, then gone;
  no sessions = one idle home octo. The dock still drives all octos (test tool).
- Badge: project tag on top, the session's activity in the pill, centred above the octo (side badges
  collided with neighbours, seen in the first screenshot).
- **Bug fixed on the way:** two badge-text changes within two frames left both words stacked on top of each
  other (also visible in agy's popup screenshot as garbled text). Every old word now leaves.
- Checked live with the real bridge, this session's real hooks and two fake sessions via the real hook
  script: 3 octos with the right names and activities (`docs/img/multi-session.png`); ending a session →
  wave → gone (3 → 2 → 1); CPU with one octo 9.8 % of a core + bridge 0.4 %; no GPU crashes.
- Known limit: the "home" spot of a new project is a guess (line-up); drag it once and it remembers.

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
1. **Eyes always look at the terminal** (replaces the spec's cursor `lookAt`). ✅ real terminal 2026-11-24; Phase 3c:
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

## Voice → text, step 1: the model runs locally (Claude, 2026-11-24)
**SKIPPED (Saud, 2026-11-25: "is idea ko bhi skip karo").** Code parked in `bridge/voice.py` (+ tests, mic fix included); its 3 pip deps are commented out in requirements.txt; model still at `models/` (1.5 GB, gitignored) until Saud says delete. Notes below kept for if it ever comes back.

Saud said go for the local Hinglish option (built-in `/voice` left untested; Hindi support unknown).
- Model: `Oriserve/Whisper-Hindi2Hinglish-Prime` @ `4edf7b8` (Whisper large-v3 fine-tune, writes Hindi in
  Roman script, Apache 2.0). Converted once in a throwaway venv (CPU torch + ctranslate2 4.9.1):
  `ct2-transformers-converter --model Oriserve/Whisper-Hindi2Hinglish-Prime --revision 4edf7b8…
  --quantization int8_float16 --copy_files tokenizer.json preprocessor_config.json --output_dir
  models/hinglish-prime-int8` → 1.5 GB (gitignored). The 6.2 GB download was removed with the HF cache
  tool afterwards (only that revision; the shared blob store's names don't match the LFS sha256s, so no
  manual deletes).
- Project venv: faster-whisper 1.2.1 + pip CUDA 12 cuBLAS / cuDNN 9 (loaded from the venv by ctypes;
  nothing system-wide). PyAV 19 rejects an argument faster-whisper 1.2.1 passes, so audio goes in as
  numpy (stdlib `wave` / raw PCM from `pw-record`), never through PyAV.
- **Measured:** peak VRAM 1,969 MiB (predicted ~2 GB); load 2.7 s; 11 s of audio in ~1.05 s (~10× real
  time); dGPU back to `suspended` within 20 s after the process ends.
- `bridge/voice.py`: record (pw-record), transcribe (lazy load, unload after 5 idle min, VAD, vocabulary
  prompt), `--smoke` and `--try N`. 3 tests (no GPU, no microphone).
- **Bug fixed 2026-11-25 (Saud: "--try nhi run hora"):** `pw-record ... -` writes a **Sun .au file** to stdout (`.snd` header + big-endian samples), not raw PCM; read as little-endian it became full-scale noise (quiet room rms 0.52). Fix: `pw-record --raw` (quiet room rms 0.0048). Tripwire: `test_record_asks_pipewire_for_raw_little_endian_pcm`.
- **"Advanced" (smart) dictation, researched 2026-11-25** (Saud wants cleanup, not word-for-word): (1) **Sarvam Dictate** API (launched 2026-11-23): Saaras v4 STT + Sarvam 105B edit in one call; removes fillers / repeats / false starts / self-corrections; `mode=translit` = Hinglish in Roman script; up to 1,000 vocab terms; returns raw + clean text; `POST /v2/dictate` (≤ 30 s clip, sync) or live `WSS /v2/dictate/ws`; ₹0.50/min, ₹100 free credit; 0 VRAM; audio leaves the laptop; data retention not found yet; benchmarks are Sarvam's own. (2) Local Whisper (built) + Claude Haiku 5.5 cleanup ($0.10/$0.50 per MTok ≈ $0.08 per 1,000 short prompts; only text leaves; needs an Anthropic API key, separate from the subscription). (3) Fully local Whisper + small Ollama LLM (~2 + ~1.3 GB VRAM, weaker cleanup). Waiting on Saud's pick.
- **Step 2 gate (set before testing):** Saud's 3 Hinglish sentences: ≥ 90 % words right (his judgement),
  Roman script, text ready ≤ 1.5 s after speaking. Waiting for Saud to run `--try`.

## Eyes on the real terminal (Claude, 2026-11-24)

Saud's first request (2026-11-20), now real: each octo looks at its own session's terminal window.
- Hook sends its parent process ids (`/proc` reads, numbers only; ≤ 8, up to systemd). Saud's sessions
  run `claude ← bash ← kitty`. Bridge validates and keeps the latest chain per session (2 tests).
- `app/cursor.py` → `app/kwin.py`: one helper, two questions: `?` (cursor) and `win <pids>` (first normal
  window owned by the closest pid: x, y, w, h, minimised), answered as JSON text over D-Bus.
- Electron re-checks every 3 s; look target = window centre, or straight down at the taskbar when the
  window is minimised. The dock's look map still overrides (test tool).
- **Bug fixed on the way:** a timed-out helper question was dropped from the queue, so its late answer
  went to the next question; with two question types a cursor reply could be read as a window.
- Checked live: this chat's octo found the real kitty window on its own; with a test window of my own
  (not Saud's windows) the gaze followed it, dropped to the taskbar when minimised and came back when
  restored; screenshot shows the octo turned toward it. Cost: ~1 ms of KWin time per lookup (0.07 % of a
  core for 2 octos, 0.2 % for 6). In auto mode no permission attention fired during many commands.
- Limits: one kitty process with several OS windows can't be told apart; tmux / ssh sessions have no
  window (octo looks ahead).

## Keyboard RGB removed (Saud, 2026-11-24)

Saud was worried about the keyboard, so the idea is gone for good. Before deciding, a read-only check
showed typing never depended on it: the laptop keys are the "AT Translated Set 2 keyboard" on the internal
i8042 bus; the AW-ELC (`187c:0551`) is a separate USB chip that only drives the lights. Nothing was ever
written to it. Removed: the dock's virtual keyboard strip and `ui/mood/keyboard.js` (+3 tests; the
temperature-emote test it held moved to `mood.test.mjs`). Phase 4 "RGB" and spec §7 no longer apply.
**Never write to, open or probe the light controller again.**

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
3. **Future: voice → text only.** Options researched 2026-11-24 (not built; Saud to pick):
   - Claude Code 2.1.331 has **built-in hold-to-talk dictation** (`/voice`, `voiceEnabled`, language in
     `/config`; cloud STT at Anthropic; falls back to English for unsupported languages; Hindi support
     not verified).
   - Local, Hinglish in Roman script: `Oriserve/Whisper-Hindi2Hinglish-Prime` (Whisper large-v3 fine-tune,
     1.54 B params, Apache 2.0): fp16 ≈ 3.1 GB weights + ~0.5 GB = ~3.6 GB VRAM; int8 via faster-whisper
     ≈ 1.5 GB + ~0.4 GB = ~2 GB → fits 6 GB. GPU wakes only while the model is loaded (load on first
     use, unload when idle). CPU would be too slow (32-layer decoder).
   - Already installed: whisper.cpp large-v3-turbo q5 (CPU, ~2.8× real time, 0 VRAM); Hindi tends to come
     out in Devanagari. Qwen3-ASR-0.6B (≈ 0.94 B params, ~1.9 GB bf16) fits too, but Hindi support unverified.
   - Typing into the right terminal: kitty remote control (`kitty @ send-text`) needs a kitty.conf change.
   The user speaks, it types. Local `whisper-cli` (whisper.cpp, CPU; already
   installed). Typing into the terminal needs `wl-clipboard` or `ydotool` (dnf, later).
   **The bot never speaks** (no text-to-speech): it would read everything, not what matters, and what
   matters is for the developer/user to decide.

## Constraints
- **No Plasma X11 session** on this laptop (it doesn't work, per Saud). The spec's "log into a Plasma
  X11 session" fallback (PROMPT.md §11) is out. The overlay runs in the Wayland session through
  XWayland; fallbacks are `CLAUDE_BOT_OZONE=wayland` or a full-width bottom-strip window.

## Blockers / open questions
- ~~Screen-lock pause (spec 3.3)~~ done 2026-11-25 (see its section).
- ~~`lookAt` needs the cursor position~~ solved 2026-11-24: KWin script gives cursor + terminal window positions.
- Blush colour for the face: not sampled yet (the clean sprites lose the tiny cheeks). Phase 3 expressions.
- Project path has a space in a parent folder (`Projects/claude bot/claude-bot`). Fine so far.
