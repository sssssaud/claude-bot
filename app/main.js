// Electron main: one octo overlay per Claude Code session (transparent, always on top, click-through
// except the octo, its badge and popup), plus the simulator dock. Each octo has its own mood
// simulator fed by its session's live pressure from the bridge. No sessions: one idle "home" octo.
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, Notification, screen, Tray } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nearestDisplay, clampOcto, toSaved, fromSaved } from './placement.js';
import { watchLock } from './screenlock.js';
import { createSimulator, MOMENTS, PERSONALITIES, restyle } from '../ui/mood/mood.js';
import { MOVES } from '../ui/scene3d/moves.js';

const here = dirname(fileURLToPath(import.meta.url));
const SIZE = { width: 680, height: 440 }; // room for a jump, a roll, the badge, and popup panel
const SLOT_PX = 250; // new octos line up to the left of the first one (badge ≈ 220 px wide)
const HOME = 'home';
const NOMINAL_OCTO = { x: 252, y: 156, width: 176, height: 168 }; // octo box at rest, until the page reports it
const MOVE_NAMES = ['idle', 'blink', ...Object.keys(MOVES)];
const MASTI_KEY = 'Control+Shift+M';

// Native Wayland apps can't keep themselves on top or pick their position; XWayland can.
// The platform is chosen before main.js runs, so appendSwitch() is too late: it left the
// browser on Wayland and the GPU process on X11, which segfaulted. Relaunch with the flag.
// (Electron records its auto-detected platform in the same switch, so compare the value; the
// marker argument makes a second relaunch impossible even if the value never matches.)
// CLAUDE_BOT_OZONE=wayland is the escape hatch if XWayland misbehaves.
const PLATFORM = process.env.CLAUDE_BOT_OZONE || 'x11';
if (app.commandLine.getSwitchValue('ozone-platform') !== PLATFORM && !app.commandLine.hasSwitch('claude-bot-relaunched')) {
  app.relaunch({ args: [...process.argv.slice(1), `--ozone-platform=${PLATFORM}`, '--claude-bot-relaunched'] });
  app.exit(0);
} else if (!app.requestSingleInstanceLock()) {
  // already running (e.g. started at login, then run.sh by hand): one set of octos is enough
  console.error('claude-bot is already running; this copy exits');
  app.exit(0);
}

let dock = null;
let quitting = false;
const octos = new Map(); // key (session id, or HOME) -> octo
const savePath = () => join(app.getPath('userData'), 'positions.json');

function loadPositions() {
  try {
    return JSON.parse(readFileSync(savePath(), 'utf8'));
  } catch {
    try { // the single-octo file from before multi-session becomes the home octo's spot
      return { [HOME]: JSON.parse(readFileSync(join(app.getPath('userData'), 'position.json'), 'utf8')) };
    } catch {
      return {}; // first run or unreadable: default spots
    }
  }
}
const placeKey = o => (o.key === HOME ? HOME : o.label.replace(/ #\d+$/, '')); // per project folder

function createOcto(key, label, slot) {
  const o = { key, label, doing: null, sim: createSimulator(), box: NOMINAL_OCTO, extras: [], shaper: null, picked: null,
    away: false, home: null, attention: null, attentionId: 0, travel: null, pids: [], look: null, moments: [] };
  const displays = screen.getAllDisplays();
  const saved = loadPositions()[placeKey(o)];
  let pos = fromSaved(saved, o.box, displays, screen.getPrimaryDisplay().id);
  if (!saved) pos = { x: pos.x - slot * SLOT_PX, y: pos.y };
  const area = nearestDisplay({ ...pos, width: SIZE.width, height: SIZE.height }, displays).workArea;
  pos = clampOcto(pos, o.box, area);
  o.win = new BrowserWindow({
    ...SIZE,
    ...pos,
    title: `Pixel Octo · ${label}`,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    // focusable: false makes Chromium create an override-redirect X11 window: KWin leaves it
    // unmanaged on its OnScreenDisplay layer (above normal and keep-above windows), out of the
    // taskbar and Alt-Tab, and clicking it never steals focus from the editor.
    focusable: false,
    show: false,
    webPreferences: { preload: join(here, 'preload.cjs') },
  });
  lockDown(o.win);
  startShaper(o);
  setInputRegion(o); // fully click-through until the page reports the octo
  o.win.once('ready-to-show', () => { if (shown()) o.win.showInactive(); });
  o.win.on('closed', () => { o.shaper?.stdin.end(); octos.delete(key); });
  o.win.loadFile(join(here, '../dist/overlay.html'));
  octos.set(key, o);
  return o;
}

function closeOcto(o) { // session over: wave goodbye, then go
  octos.delete(o.key);
  if (o.win.isDestroyed()) return;
  o.win.webContents.send('octo:play', 'wave');
  setTimeout(() => { if (!o.win.isDestroyed()) o.win.close(); }, 1700);
}

// Make the set of octos match the live sessions (oldest first). Creates before it closes:
// with zero windows for a moment Electron would quit.
function syncOctos(sessions) {
  const wanted = sessions.length ? sessions : [{ id: HOME, project: 'Claude Bot', doing: null }];
  wanted.forEach((s, slot) => {
    const o = octos.get(s.id) ?? createOcto(s.id, s.project, slot);
    o.label = s.project;
    o.doing = (prefs.showDetails && typeof s.detail === 'string' && s.detail) || s.doing; // option 2: Claude's own words
    o.moments = Array.isArray(s.moments) ? s.moments.filter(m => Object.hasOwn(MOMENTS, m)) : []; // the session's situations
    if (Array.isArray(s.pids) && s.pids.join() !== o.pids.join()) { o.pids = s.pids; refreshLook(o); }
    attend(o, s);
    if (s.id !== HOME && isNum(s.pressure, 0, 100) && clock() >= manualUntil) o.sim.feed(s.pressure);
  });
  const keep = new Set(wanted.map(s => s.id));
  for (const o of [...octos.values()]) if (!keep.has(o.key)) closeOcto(o);
}

// ---- attention (Saud 2026-11-23): a session needing permission, or done, calls its octo to the cursor ----
const TRAVEL_MS = 700;
// app/kwin.py answers what only KWin knows under Wayland: the cursor, and a session's terminal window.
let kwin = null;
let kwinWaiters = []; // one per question, answered strictly in order
function startKwinHelper() {
  try {
    kwin = spawn('python3', ['-I', join(here, 'kwin.py')], { stdio: ['pipe', 'pipe', 'inherit'] });
  } catch (err) {
    console.error('kwin helper unavailable:', err.message);
    return;
  }
  let buf = '';
  kwin.stdout.on('data', chunk => {
    buf += chunk;
    for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) kwinWaiters.shift()?.(buf.slice(0, i));
  });
  kwin.stdin.on('error', () => {});
  kwin.on('error', err => console.error('kwin.py did not start:', err.message));
  kwin.on('exit', code => {
    kwin = null;
    for (const w of kwinWaiters.splice(0)) w(null);
    if (code && !quitting) console.error(`kwin.py exited (${code}); octos react in place and look ahead`);
  });
}
function askKwin(question) { // the answer line, or null
  if (!kwin) return Promise.resolve(null);
  return new Promise(resolve => {
    let settled = false;
    const finish = v => { if (!settled) { settled = true; clearTimeout(t); resolve(v); } };
    // on a timeout the waiter stays queued: the late answer is still consumed by it, so the next
    // question never receives this one's answer (they used to get out of step)
    const t = setTimeout(() => finish(null), 1500);
    kwinWaiters.push(finish);
    kwin.stdin.write(`${question}\n`);
  });
}
async function askCursor() { // { x, y } in screen pixels, or null
  const m = /^(-?\d+) (-?\d+)$/.exec((await askKwin('?')) ?? '');
  return m ? { x: +m[1], y: +m[2] } : null;
}
async function askWindow(pids) { // the session's terminal window { x, y, w, h, min, active }, or null
  const answer = await askKwin(`win ${pids.join(' ')}`);
  let w;
  try {
    w = JSON.parse(answer);
  } catch {
    return null; // "none" (no window: tmux, ssh, headless) or no answer
  }
  const ok = w && isInt(w.x, -1e5, 1e5) && isInt(w.y, -1e5, 1e5) && isInt(w.w, 1, 1e5) && isInt(w.h, 1, 1e5) && typeof w.min === 'boolean' && typeof w.active === 'boolean';
  return ok ? w : null;
}

// Eyes on the terminal (Saud 2026-11-20): each octo looks at its own session's terminal window; at its
// taskbar spot when the window is minimised. Re-checked every few seconds (windows move).
const LOOK_EVERY_MS = 3000;
async function refreshLook(o) {
  if (!o.pids.length || !shown() || o.win.isDestroyed()) return;
  const w = await askWindow(o.pids);
  if (!w) { o.look = null; return; }
  const cx = w.x + w.w / 2;
  const area = nearestDisplay({ x: w.x, y: w.y, width: w.w, height: w.h }, screen.getAllDisplays());
  o.look = { x: Math.round(cx), y: w.min ? area.bounds.y + area.bounds.height : Math.round(w.y + w.h / 2) };
}

function glide(o, to, then) { // move the window there over TRAVEL_MS, legs flailing
  clearInterval(o.travel);
  if (o.win.isDestroyed()) return;
  const [fx, fy] = o.win.getPosition();
  const start = performance.now();
  o.win.webContents.send('octo:travel', true);
  o.travel = setInterval(() => {
    if (o.win.isDestroyed()) return clearInterval(o.travel);
    const k = Math.min(1, (performance.now() - start) / TRAVEL_MS);
    const e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2; // ease in-out
    o.win.setPosition(Math.round(fx + (to.x - fx) * e), Math.round(fy + (to.y - fy) * e));
    if (k === 1) {
      clearInterval(o.travel);
      o.travel = null;
      o.win.webContents.send('octo:travel', false);
      then?.();
    }
  }, 16);
}

async function comeOver(o, kind) {
  const move = kind === 'done' ? 'flipJump' : 'jump';
  if (kind === 'done' && o.pids.length) { // you're already looking at that terminal: cheer in place, don't walk over
    const w = await askWindow(o.pids);
    if (w?.active && !w.min) {
      console.error(`${o.label}: done, its terminal is in front: reacting in place`);
      return o.win.isDestroyed() || o.win.webContents.send('octo:play', move);
    }
  }
  const cursor = await askCursor();
  if (o.win.isDestroyed()) return;
  if (!cursor) return o.win.webContents.send('octo:play', move); // can't find the cursor: react in place
  if (!o.away) {
    const [x, y] = o.win.getPosition();
    o.home = { x, y };
    o.away = true;
  }
  // beside the cursor, not under it; octos already waiting there line up to the right
  const slot = [...octos.values()].filter(other => other.away && other !== o).length;
  const want = { x: cursor.x + 32 + slot * (o.box.width + 12) - o.box.x, y: cursor.y - Math.round(o.box.height * 0.6) - o.box.y };
  const area = nearestDisplay({ x: cursor.x, y: cursor.y, width: 1, height: 1 }, screen.getAllDisplays()).workArea;
  glide(o, clampOcto(want, o.box, area), () => o.win.webContents.send('octo:play', move));
}

function goHome(o) {
  if (!o.away) return;
  o.away = false;
  if (o.home) glide(o, o.home);
}

const mayCome = kind => shown() && prefs.comeOver &&
  bridge.config?.attention?.[{ permission: 'come_for_permission', done: 'come_when_done' }[kind]] !== false;

function attend(o, s) {
  o.attention = s.attention;
  if (s.attention && s.attention_id !== o.attentionId) {
    o.attentionId = s.attention_id;
    if (mayCome(s.attention)) comeOver(o, s.attention);
  } else if (!s.attention && o.away) goHome(o);
}

// ---- tray + preferences (spec §9) ----
// prefs.json in the app's config folder: { hidden, comeOver, showDetails }. Bad or missing file = defaults.
// showDetails: the badge says what the session does in Claude's words ("Run all tests", "Editing main.js");
// off = generic labels only ("Running a command"), e.g. while sharing the screen.
// personality: Friendly / Dramatic / Calm (ui/mood/mood.js PERSONALITIES), from the tray or the dock.
const PREFS = { hidden: false, comeOver: true, showDetails: true, personality: 'friendly' };
const prefsPath = () => join(app.getPath('userData'), 'prefs.json');
let prefs = { ...PREFS };
function loadPrefs() {
  try {
    const raw = JSON.parse(readFileSync(prefsPath(), 'utf8'));
    for (const k of Object.keys(PREFS)) if (typeof raw[k] === typeof PREFS[k]) prefs[k] = raw[k];
    if (!Object.hasOwn(PERSONALITIES, prefs.personality)) prefs.personality = PREFS.personality;
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('prefs.json unreadable, using defaults:', err.message);
  }
}
function savePrefs() {
  try {
    writeFileSync(prefsPath(), JSON.stringify(prefs));
  } catch (err) {
    console.error('could not save prefs:', err.message);
  }
}
const warn = text => { console.error(text); new Notification({ title: 'Claude Bot', body: text }).show(); };

// Start on login: an XDG autostart entry that runs run.sh (bridge + octos). Electron's own
// setLoginItemSettings does nothing on Linux.
const AUTOSTART = join(homedir(), '.config', 'autostart', 'claude-bot.desktop');
const ROOT = join(here, '..');
function setAutostart(on) {
  try {
    if (!on) {
      if (existsSync(AUTOSTART)) unlinkSync(AUTOSTART);
      return;
    }
    if (/["`$\\\n]/.test(ROOT)) throw new Error(`can't put this folder in a .desktop Exec line: ${ROOT}`);
    mkdirSync(dirname(AUTOSTART), { recursive: true });
    writeFileSync(AUTOSTART, [
      '[Desktop Entry]', 'Type=Application', 'Name=Claude Bot',
      'Comment=Pixel Octo: one octo per Claude Code session',
      `Exec=bash "${join(ROOT, 'run.sh')}"`, `Icon=${join(here, 'icon.png')}`, 'Terminal=false', '',
    ].join('\n'));
  } catch (err) {
    warn(`Start on login: ${err.message}`);
  }
}

// Octos show unless hidden from the tray (saved) or the screen is locked (spec 3.3; not saved).
let locked = false;
let lockMon = null;
const shown = () => !prefs.hidden && !locked;

function applyShown() { // hidden windows don't draw: no CPU
  const on = shown();
  for (const o of octos.values()) {
    if (o.win.isDestroyed()) continue;
    if (!on) { goHome(o); o.win.hide(); continue; }
    o.win.showInactive();
    if (o.attention === 'permission' && mayCome('permission')) comeOver(o, 'permission'); // still waiting for you
  }
  if (!on) dock?.hide();
}

function setPersonality(name) {
  if (!Object.hasOwn(PERSONALITIES, name) || prefs.personality === name) return;
  prefs.personality = name;
  savePrefs();
  refreshTray();
}

function setHidden(on) {
  prefs.hidden = on;
  savePrefs();
  applyShown();
  refreshTray();
}

function setLocked(on) {
  if (on === locked) return; // KDE can announce the same state twice
  locked = on;
  console.error(on ? 'screen locked: octos hidden' : 'screen unlocked: octos back');
  if (!prefs.hidden) applyShown();
}

let tray = null;
function refreshTray() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: prefs.hidden ? 'Show octos' : 'Hide octos', click: () => setHidden(!prefs.hidden) },
    { label: 'Simulator dock', click: toggleDock },
    { label: 'Masti', click: () => each(o => o.sim.toggleMasti(clock())) },
    { type: 'separator' },
    { label: 'Come to my cursor', type: 'checkbox', checked: prefs.comeOver,
      click: item => { prefs.comeOver = item.checked; savePrefs(); if (!prefs.comeOver) each(goHome); refreshTray(); } },
    { label: 'Personality', submenu: Object.entries(PERSONALITIES).map(([name, p]) => (
      { label: p.label, type: 'radio', checked: prefs.personality === name, click: () => setPersonality(name) })) },
    { label: 'Show details', type: 'checkbox', checked: prefs.showDetails,
      click: item => { prefs.showDetails = item.checked; savePrefs(); refreshTray(); } },
    { label: 'Start on login', type: 'checkbox', checked: existsSync(AUTOSTART),
      click: item => { setAutostart(item.checked); refreshTray(); } },
    { type: 'separator' },
    { label: 'Quit Claude Bot', click: () => app.quit() },
  ]));
}
function createTray() {
  try {
    tray = new Tray(join(here, 'icon.png'));
    tray.setToolTip('Claude Bot');
    tray.on('click', () => setHidden(!prefs.hidden)); // left click: show/hide; right click: the menu
    refreshTray();
  } catch (err) {
    console.error('no tray (the octos still work; quit with pkill):', err.message);
  }
}

// The simulator dock: a normal window, hidden until a badge is clicked; closing just hides it.
function toggleDock() {
  if (!dock) {
    dock = new BrowserWindow({
      width: 380, height: 780, show: false, title: 'Pixel Octo · Simulator',
      backgroundColor: '#17121a', autoHideMenuBar: true,
      webPreferences: { preload: join(here, 'dock-preload.cjs') },
    });
    lockDown(dock);
    dock.on('close', e => { if (!quitting) { e.preventDefault(); dock.hide(); } });
    dock.once('ready-to-show', () => dock.show());
    dock.loadFile(join(here, '../dist/dock.html'));
  } else if (dock.isVisible()) dock.hide();
  else dock.show();
}

function lockDown(w) { // our own pages only: no new windows, no navigation away
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', e => e.preventDefault());
}

// Click-through: each window's input region is its octo's box (plus badge and popup), so the
// compositor itself sends every other click to the window below. ponytail: not the spec's cursor
// polling; under XWayland, X11 apps don't see the cursor while it's over Wayland windows.
function startShaper(o) {
  if (PLATFORM !== 'x11') return; // native Wayland: setShape() below
  try {
    const id = o.win.getNativeWindowHandle().readUInt32LE(); // X11 window ids are 29-bit; Electron 45 gives 4 bytes
    o.shaper = spawn('python3', ['-I', join(here, 'xinput_shape.py'), `0x${id.toString(16)}`], { stdio: ['pipe', 'ignore', 'inherit'] });
    o.shaper.stdin.on('error', () => {}); // helper gone: the exit handler reports it
    o.shaper.on('error', err => console.error('xinput_shape.py did not start:', err.message));
    o.shaper.on('exit', code => {
      o.shaper = null;
      if (code) console.error(`xinput_shape.py exited (${code}); falling back to setShape()`);
    });
  } catch (err) {
    o.shaper = null;
    console.error('click-through helper unavailable, using setShape():', err.message);
  }
}

function setInputRegion(o, rects = []) {
  if (o.shaper) o.shaper.stdin.write(`${rects.map(r => `${r.x} ${r.y} ${r.width} ${r.height}`).join(' ')}\n`);
  else if (!o.win.isDestroyed()) o.win.setShape(rects);
}

// Keep an octo inside the nearest display; remember the spot (per project folder) only when the
// user dropped it there, not when a session's octo merely appeared.
function settle(o, save = false) {
  if (o.win.isDestroyed()) return;
  const [x, y] = o.win.getPosition();
  const display = nearestDisplay({ x: x + o.box.x, y: y + o.box.y, width: o.box.width, height: o.box.height }, screen.getAllDisplays());
  const pos = clampOcto({ x, y }, o.box, display.workArea);
  o.win.setPosition(pos.x, pos.y);
  if (!save) return;
  try {
    writeFileSync(savePath(), JSON.stringify({ ...loadPositions(), [placeKey(o)]: toSaved(pos, o.box, display) }));
  } catch (err) {
    console.error('could not save the position:', err.message);
  }
}

// ---- shared state: each octo's own simulator (ui/mood/mood.js) + what all octos share, at 10 Hz ----
const clock = () => performance.now() / 1000;
const TEMPS_OVERRIDE_S = 60; // the dock's fake temperatures (and battery) win for a minute after the last slider move
let fakeTemps = { cpu: 55, gpu: 50 };
let fakeBattery = 100; // %; 100 = plugged in, lower = on battery
let fakeTempsUntil = -Infinity;
let dockLook = null; // { fx, fy }: a look target set by hand in the dock (test tool); wins over the real terminal
const bridge = { ws: null, connected: false, telemetry: null, controls: null, usage: null, config: null, load: 0 };
const MANUAL_S = 60; // the dock's pressure slider / masti / demo win over live data for a minute
let manualUntil = -Infinity;
const BRIDGE = 'http://127.0.0.1:8765';

function currentTemps(now) {
  const t = bridge.telemetry;
  if (now < fakeTempsUntil || !bridge.connected || !t) return fakeTemps;
  return { cpu: t.cpu?.temp ?? null, gpu: t.gpu?.awake ? t.gpu.temp : null }; // asleep GPU: no reading
}

setInterval(() => {
  const now = clock();
  const shared = {
    temps: currentTemps(now), bridge: bridge.connected, personality: prefs.personality,
    telemetry: now < fakeTempsUntil ? { ...bridge.telemetry, battery: { percent: fakeBattery, plugged: fakeBattery >= 100 } } : bridge.telemetry,
    controls: bridge.controls, usage: bridge.usage, config: bridge.config,
  };
  let first = null;
  for (const o of octos.values()) {
    if (o.win.isDestroyed()) continue;
    const state = { ...o.sim.state(now), ...shared, look: dockLook ?? o.look, label: o.label, doing: o.doing, moments: o.moments, emote: o.picked && now < o.picked.until ? o.picked.emote : null };
    o.win.webContents.send('sim:state', state);
    first ??= state;
  }
  if (first && dock?.isVisible()) dock.webContents.send('sim:state', first);
}, 100);

const notify = (o, text) => { if (o && !o.win.isDestroyed()) o.win.webContents.send('octo:notice', text); };
const each = fn => { for (const o of octos.values()) fn(o); };

// Commands from the bridge (KDE shortcut, Claude Code hooks): the bridge validates them; check again.
function applyCommand(m) {
  const now = clock();
  const isEmote = v => typeof v === 'string' && /^\d\d_[a-z_]+$/.test(v);
  if (m.cmd === 'masti') each(o => o.sim.toggleMasti(now));
  else if (m.cmd === 'pressure' && isNum(m.value, 0, 100)) each(o => o.sim.setPressure(m.value, now));
  else if (m.cmd === 'look' && (m.look === null || (isNum(m.look?.fx, 0, 1) && isNum(m.look?.fy, 0, 1)))) dockLook = m.look && { fx: m.look.fx, fy: m.look.fy };
  else if (m.cmd === 'emote' && isEmote(m.name) && isNum(m.duration, 0.5, 30)) each(o => { o.picked = { emote: m.name, until: now + m.duration }; });
  else if (m.cmd === 'react' && isEmote(m.emote)) { // a Claude Code moment: only that session's octo reacts
    const o = octos.get(m.session) ?? (octos.size === 1 ? [...octos.values()][0] : null);
    if (!o || o.win.isDestroyed()) return;
    const r = restyle(prefs.personality, m.emote, m.move); // the same moment in this personality's style
    if (r.emote) o.picked = { emote: r.emote, until: now + 6 };
    if (MOVE_NAMES.includes(r.move)) o.win.webContents.send('octo:play', r.move);
  } else console.warn('bridge: ignored command', JSON.stringify(m).slice(0, 200));
}

const isSession = s => s && typeof s.id === 'string' && s.id.length <= 64 && typeof s.project === 'string'
  && s.project.length <= 48 && (s.doing === null || typeof s.doing === 'string') && isNum(s.pressure, 0, 100)
  && [null, 'permission', 'done'].includes(s.attention ?? null) && isInt(s.attention_id ?? 0, 0, 1e9)
  && (s.pids === undefined || (Array.isArray(s.pids) && s.pids.length <= 8 && s.pids.every(p => isInt(p, 2, 4194304))));

function connectBridge() {
  if (quitting) return;
  const ws = new WebSocket(`${BRIDGE.replace('http', 'ws')}/ws`); // errors arrive as events, not throws
  bridge.ws = ws;
  ws.onopen = () => { bridge.connected = true; };
  ws.onmessage = event => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (err) {
      console.warn('bridge: bad message', err.message);
      return;
    }
    if (msg.type === 'init') {
      bridge.telemetry = msg.telemetry ?? null;
      bridge.controls = msg.controls ?? null;
      bridge.usage = msg.usage ?? null;
      bridge.config = msg.config ?? null;
    } else if (msg.type === 'telemetry') bridge.telemetry = msg.data;
    else if (msg.type === 'controls') bridge.controls = msg.data;
    else if (msg.type === 'usage') bridge.usage = msg.data;
    else if (msg.type === 'live' && Array.isArray(msg.sessions) && msg.sessions.length <= 6 && msg.sessions.every(isSession)) {
      bridge.load = isNum(msg.load, 0, 100) ? msg.load : 0;
      syncOctos(msg.sessions);
      const home = octos.get(HOME);
      if (home && clock() >= manualUntil) home.sim.feed(0.3 * bridge.load); // no sessions: machine load only
    } else if (msg.type === 'cmd') applyCommand(msg);
  };
  ws.onclose = () => { // bridge not running or restarted: keep the octos going, retry
    bridge.connected = false;
    bridge.ws = null;
    if (!quitting) setTimeout(connectBridge, 2000);
  };
}

// Quick controls from a popup: checked here, applied by the bridge, failures shown as a toast.
const CONTROLS = {
  bluetooth: v => typeof v === 'boolean' && { enabled: v },
  wifi: v => typeof v === 'boolean' && { enabled: v },
  brightness: v => isInt(v, 5, 100) && { percent: v },
};
// One request per control at a time; while one runs, only the newest value waits (a dragged brightness
// slider sends ~every frame, the bridge takes ~0.1 s: the screen follows the finger, nothing piles up).
const controlBusy = {};
const controlNext = {};
async function setControl(o, type, value) {
  const payload = CONTROLS[type]?.(value);
  if (!payload) return;
  if (!bridge.connected) return notify(o, 'Bridge offline: start it with ./run.sh');
  if (controlBusy[type]) { controlNext[type] = { o, value }; return; }
  controlBusy[type] = true;
  try {
    const res = await fetch(`${BRIDGE}/controls/${type}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
    bridge.controls = await res.json();
  } catch (err) {
    console.error(`control ${type} failed:`, err.message);
    notify(o, `Couldn't change ${type}`);
  } finally {
    controlBusy[type] = false;
    const next = controlNext[type];
    delete controlNext[type];
    if (next) setControl(next.o, type, next.value);
  }
}

// ---- IPC: every message is checked for its sender and its values ----
const octoOf = e => [...octos.values()].find(o => !o.win.isDestroyed() && o.win.webContents === e.sender);
const fromDock = e => e.sender === dock?.webContents;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
const isRect = r => r && isInt(r.x, 0, SIZE.width) && isInt(r.y, 0, SIZE.height)
  && isInt(r.width, 1, SIZE.width - r.x) && isInt(r.height, 1, SIZE.height - r.y);
const pick = r => ({ x: r.x, y: r.y, width: r.width, height: r.height });

ipcMain.on('octo:region', (e, region) => {
  const o = octoOf(e);
  if (!o || !isRect(region?.octo)) return;
  const extras = Array.isArray(region.extras) ? region.extras.slice(0, 5) : [];
  if (!extras.every(isRect)) return;
  const first = o.box === NOMINAL_OCTO;
  o.box = pick(region.octo);
  o.extras = extras.map(pick);
  setInputRegion(o, [o.box, ...o.extras]);
  if (first) settle(o); // the startup spot used a guessed box; clamp again with the real one
});
ipcMain.on('octo:move', (e, x, y) => {
  const o = octoOf(e);
  if (o) { clearInterval(o.travel); o.travel = null; } // the user's drag wins over a glide
  if (o && isInt(x, -1e5, 1e5) && isInt(y, -1e5, 1e5)) o.win.setPosition(x, y);
});
ipcMain.on('octo:drop', e => {
  const o = octoOf(e);
  if (!o) return;
  o.away = false; // dropped somewhere by hand: that's its home now
  settle(o, true);
});
ipcMain.on('octo:clicked', e => { const o = octoOf(e); if (o) goHome(o); }); // "seen it": go back
ipcMain.on('dock:toggle', e => { if (octoOf(e)) toggleDock(); });

// the dock is a test tool: it drives every octo
ipcMain.on('sim:pressure', (e, v) => {
  if (fromDock(e) && isNum(v, 0, 100)) { each(o => o.sim.setPressure(v, clock())); manualUntil = clock() + MANUAL_S; }
});
ipcMain.on('sim:masti', e => { if (fromDock(e)) each(o => o.sim.toggleMasti(clock())); });
ipcMain.on('sim:personality', (e, name) => { if (fromDock(e)) setPersonality(name); }); // same setting as the tray
ipcMain.on('sim:demo', (e, on) => { if (fromDock(e) && typeof on === 'boolean') each(o => o.sim.setDemo(on, clock())); });
ipcMain.on('sim:temps', (e, t) => {
  if (fromDock(e) && isNum(t?.cpu, 20, 110) && isNum(t?.gpu, 20, 110) && isNum(t?.battery, 0, 100)) {
    fakeTemps = { cpu: t.cpu, gpu: t.gpu };
    fakeBattery = t.battery;
    fakeTempsUntil = clock() + TEMPS_OVERRIDE_S;
  }
});
ipcMain.on('sim:emote', (e, name) => {
  if (fromDock(e) && typeof name === 'string' && /^\d\d_[a-z_]+$/.test(name)) each(o => { o.picked = { emote: name, until: clock() + 6 }; });
});
ipcMain.on('sim:look', (e, l) => {
  if (fromDock(e) && (l === null || (isNum(l?.fx, 0, 1) && isNum(l?.fy, 0, 1)))) dockLook = l && { fx: l.fx, fy: l.fy };
});
ipcMain.on('controls:set', (e, type, value) => {
  const o = octoOf(e);
  if (o || fromDock(e)) setControl(o, type, value);
});
ipcMain.on('octo:play', (e, name) => {
  if (fromDock(e) && MOVE_NAMES.includes(name)) each(o => o.win.webContents.send('octo:play', name));
});
ipcMain.handle('dock:moves', e => (fromDock(e) ? MOVE_NAMES : []));

app.whenReady().then(() => {
  loadPrefs();
  createTray();
  syncOctos([]); // the home octo, until the bridge reports sessions
  startKwinHelper();
  lockMon = watchLock(setLocked);
  setInterval(() => each(refreshLook), LOOK_EVERY_MS);
  connectBridge();
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, () => each(settle));
  // Under XWayland this only fires while an X11 window has focus; the bridge's POST /masti
  // is the fallback for a KDE custom shortcut.
  if (!globalShortcut.register(MASTI_KEY, () => each(o => o.sim.toggleMasti(clock())))) console.error(`could not register ${MASTI_KEY}`);
});
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { globalShortcut.unregisterAll(); kwin?.stdin.end(); lockMon?.kill(); });
// octos come and go with sessions; the app ends only through the tray's Quit (or a signal)
app.on('window-all-closed', () => {});
