// Electron main: one octo overlay per Claude Code session (transparent, always on top, click-through
// except the octo, its badge and popup), plus the simulator dock. Each octo has its own mood
// simulator fed by its session's live pressure from the bridge. No sessions: one idle "home" octo.
import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nearestDisplay, clampOcto, toSaved, fromSaved } from './placement.js';
import { createSimulator } from '../ui/mood/mood.js';
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
  const o = { key, label, doing: null, sim: createSimulator(), box: NOMINAL_OCTO, extras: [], shaper: null, picked: null };
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
  o.win.once('ready-to-show', () => o.win.showInactive());
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
    o.doing = s.doing;
    if (s.id !== HOME && isNum(s.pressure, 0, 100) && clock() >= manualUntil) o.sim.feed(s.pressure);
  });
  const keep = new Set(wanted.map(s => s.id));
  for (const o of [...octos.values()]) if (!keep.has(o.key)) closeOcto(o);
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
const TEMPS_OVERRIDE_S = 60; // the dock's fake temperatures win for a minute after the last slider move
let fakeTemps = { cpu: 55, gpu: 50 };
let fakeTempsUntil = -Infinity;
let look = null; // { fx, fy }: where the terminal is, as fractions of the screen
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
    temps: currentTemps(now), look, bridge: bridge.connected,
    telemetry: bridge.telemetry, controls: bridge.controls, usage: bridge.usage, config: bridge.config,
  };
  let first = null;
  for (const o of octos.values()) {
    if (o.win.isDestroyed()) continue;
    const state = { ...o.sim.state(now), ...shared, label: o.label, doing: o.doing, emote: o.picked && now < o.picked.until ? o.picked.emote : null };
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
  else if (m.cmd === 'look' && (m.look === null || (isNum(m.look?.fx, 0, 1) && isNum(m.look?.fy, 0, 1)))) look = m.look && { fx: m.look.fx, fy: m.look.fy };
  else if (m.cmd === 'emote' && isEmote(m.name) && isNum(m.duration, 0.5, 30)) each(o => { o.picked = { emote: m.name, until: now + m.duration }; });
  else if (m.cmd === 'react' && isEmote(m.emote)) { // a Claude Code moment: only that session's octo reacts
    const o = octos.get(m.session) ?? (octos.size === 1 ? [...octos.values()][0] : null);
    if (!o || o.win.isDestroyed()) return;
    o.picked = { emote: m.emote, until: now + 6 };
    if (MOVE_NAMES.includes(m.move)) o.win.webContents.send('octo:play', m.move);
  } else console.warn('bridge: ignored command', JSON.stringify(m).slice(0, 200));
}

const isSession = s => s && typeof s.id === 'string' && s.id.length <= 64 && typeof s.project === 'string'
  && s.project.length <= 48 && (s.doing === null || typeof s.doing === 'string') && isNum(s.pressure, 0, 100);

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
async function setControl(o, type, value) {
  const payload = CONTROLS[type]?.(value);
  if (!payload) return;
  if (!bridge.connected) return notify(o, 'Bridge offline: start it with ./run.sh');
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
  if (o && isInt(x, -1e5, 1e5) && isInt(y, -1e5, 1e5)) o.win.setPosition(x, y);
});
ipcMain.on('octo:drop', e => { const o = octoOf(e); if (o) settle(o, true); });
ipcMain.on('dock:toggle', e => { if (octoOf(e)) toggleDock(); });

// the dock is a test tool: it drives every octo
ipcMain.on('sim:pressure', (e, v) => {
  if (fromDock(e) && isNum(v, 0, 100)) { each(o => o.sim.setPressure(v, clock())); manualUntil = clock() + MANUAL_S; }
});
ipcMain.on('sim:masti', e => { if (fromDock(e)) each(o => o.sim.toggleMasti(clock())); });
ipcMain.on('sim:demo', (e, on) => { if (fromDock(e) && typeof on === 'boolean') each(o => o.sim.setDemo(on, clock())); });
ipcMain.on('sim:temps', (e, t) => {
  if (fromDock(e) && isNum(t?.cpu, 20, 110) && isNum(t?.gpu, 20, 110)) {
    fakeTemps = { cpu: t.cpu, gpu: t.gpu };
    fakeTempsUntil = clock() + TEMPS_OVERRIDE_S;
  }
});
ipcMain.on('sim:emote', (e, name) => {
  if (fromDock(e) && typeof name === 'string' && /^\d\d_[a-z_]+$/.test(name)) each(o => { o.picked = { emote: name, until: clock() + 6 }; });
});
ipcMain.on('sim:look', (e, l) => {
  if (fromDock(e) && (l === null || (isNum(l?.fx, 0, 1) && isNum(l?.fy, 0, 1)))) look = l && { fx: l.fx, fy: l.fy };
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
  syncOctos([]); // the home octo, until the bridge reports sessions
  connectBridge();
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, () => each(settle));
  // Under XWayland this only fires while an X11 window has focus; the bridge's POST /masti
  // is the fallback for a KDE custom shortcut.
  if (!globalShortcut.register(MASTI_KEY, () => each(o => o.sim.toggleMasti(clock())))) console.error(`could not register ${MASTI_KEY}`);
});
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
// octos come and go with sessions; the app ends when it's quit (pkill, later the tray's Quit)
app.on('window-all-closed', () => {});
