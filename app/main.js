// Electron main: the octo overlay (transparent, always on top, click-through except the octo
// and its badge), the simulator dock, and the simulator state both windows share. In Phase 4
// the bridge replaces the simulator as the source of that state.
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

let win;
let dock = null;
let quitting = false;
let octo = NOMINAL_OCTO;
let extraRects = []; // other clickable boxes in the overlay (the badge)
let shaper = null;
const savePath = () => join(app.getPath('userData'), 'position.json');

function loadSaved() {
  try {
    return JSON.parse(readFileSync(savePath(), 'utf8'));
  } catch {
    return null; // first run or unreadable: default spot
  }
}

function createWindow() {
  const displays = screen.getAllDisplays();
  const pos = fromSaved(loadSaved(), octo, displays, screen.getPrimaryDisplay().id);
  win = new BrowserWindow({
    ...SIZE,
    ...pos,
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
  lockDown(win);
  startShaper();
  setInputRegion(); // fully click-through until the page reports the octo
  win.once('ready-to-show', () => win.showInactive());
  win.on('closed', () => app.quit());
  win.loadFile(join(here, '../dist/overlay.html'));
}

// The simulator dock: a normal window, hidden until the badge is clicked; closing just hides it.
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

// Click-through: the window's input region is the octo's box (plus the badge), so the compositor
// itself sends every other click to the window below. ponytail: not the spec's cursor polling;
// under XWayland, X11 apps don't see the cursor while it's over Wayland windows.
function startShaper() {
  if (PLATFORM !== 'x11') return; // native Wayland: setShape() below
  try {
    const id = win.getNativeWindowHandle().readUInt32LE(); // X11 window ids are 29-bit; Electron 45 gives 4 bytes
    shaper = spawn('python3', ['-I', join(here, 'xinput_shape.py'), `0x${id.toString(16)}`], { stdio: ['pipe', 'ignore', 'inherit'] });
    shaper.stdin.on('error', () => {}); // helper gone: the exit handler reports it
    shaper.on('error', err => console.error('xinput_shape.py did not start:', err.message));
    shaper.on('exit', code => {
      shaper = null;
      if (code) console.error(`xinput_shape.py exited (${code}); falling back to setShape()`);
    });
  } catch (err) {
    shaper = null;
    console.error('click-through helper unavailable, using setShape():', err.message);
  }
}

function setInputRegion(rects = []) {
  if (shaper) shaper.stdin.write(`${rects.map(r => `${r.x} ${r.y} ${r.width} ${r.height}`).join(' ')}\n`);
  else win.setShape(rects);
}

// Keep the octo inside the nearest display and remember where it is.
function settle() {
  const [x, y] = win.getPosition();
  const display = nearestDisplay({ x: x + octo.x, y: y + octo.y, width: octo.width, height: octo.height }, screen.getAllDisplays());
  const pos = clampOcto({ x, y }, octo, display.workArea);
  win.setPosition(pos.x, pos.y);
  try {
    writeFileSync(savePath(), JSON.stringify(toSaved(pos, octo, display)));
  } catch (err) {
    console.error('could not save the position:', err.message);
  }
}

// ---- simulator state, shared by the overlay and the dock (10 Hz) ----
const sim = createSimulator();
const clock = () => performance.now() / 1000;
let temps = { cpu: 55, gpu: 50 }; // fake °C from the dock's telemetry override or real from bridge
let picked = null; // { emote, until }: an emote chosen in the dock
let look = null; // { fx, fy }: where the terminal is, as fractions of the screen (fake now; the bridge finds it in Phase 4)

// ---- Bridge WebSocket client (Phase 4) ----
let bridgeWs = null;
let bridgeConnected = false;
let bridgeTelemetry = null;
let bridgeControls = null;

function forwardState(state) {
  win?.webContents.send('sim:state', state);
  if (dock?.isVisible()) dock.webContents.send('sim:state', state);
}

function connectBridge() {
  if (quitting) return;
  try {
    bridgeWs = new WebSocket('ws://127.0.0.1:8765/ws');
    bridgeWs.onopen = () => {
      bridgeConnected = true;
    };
    bridgeWs.onmessage = event => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'init') {
          bridgeConnected = true;
          if (msg.telemetry) bridgeTelemetry = msg.telemetry;
          if (msg.controls) bridgeControls = msg.controls;
          if (msg.state) forwardState({ ...msg.state, telemetry: bridgeTelemetry, controls: bridgeControls, bridge: true });
        } else if (msg.type === 'state') {
          forwardState({ ...msg.data, telemetry: bridgeTelemetry, controls: bridgeControls, bridge: true });
        } else if (msg.type === 'telemetry') {
          bridgeTelemetry = msg.data;
          if (msg.data?.cpu?.temp) temps.cpu = msg.data.cpu.temp;
          if (msg.data?.gpu?.temp) temps.gpu = msg.data.gpu.temp;
          forwardState({ ...sim.state(clock()), temps, look, bridge: true, telemetry: bridgeTelemetry, controls: bridgeControls });
        } else if (msg.type === 'controls') {
          bridgeControls = msg.data;
          forwardState({ ...sim.state(clock()), temps, look, bridge: true, telemetry: bridgeTelemetry, controls: bridgeControls });
        }
      } catch (err) {}
    };
    bridgeWs.onclose = () => {
      bridgeConnected = false;
      bridgeWs = null;
      if (!quitting) setTimeout(connectBridge, 2000);
    };
    bridgeWs.onerror = () => {
      bridgeConnected = false;
      try { bridgeWs?.close(); } catch {}
    };
  } catch (err) {
    bridgeConnected = false;
    if (!quitting) setTimeout(connectBridge, 2000);
  }
}

setInterval(() => {
  if (!bridgeConnected) {
    const now = clock();
    const state = {
      ...sim.state(now),
      temps,
      look,
      emote: picked && now < picked.until ? picked.emote : null,
      bridge: false,
      telemetry: bridgeTelemetry,
      controls: bridgeControls,
    };
    forwardState(state);
  }
}, 100);

// ---- IPC: every message is checked for its sender and its values ----
const fromOverlay = e => e.sender === win?.webContents;
const fromDock = e => e.sender === dock?.webContents;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
const isRect = r => r && isInt(r.x, 0, SIZE.width) && isInt(r.y, 0, SIZE.height)
  && isInt(r.width, 1, SIZE.width - r.x) && isInt(r.height, 1, SIZE.height - r.y);
const pick = r => ({ x: r.x, y: r.y, width: r.width, height: r.height });

ipcMain.on('octo:region', (e, region) => {
  if (!fromOverlay(e) || !isRect(region?.octo)) return;
  const extras = Array.isArray(region.extras) ? region.extras.slice(0, 5) : [];
  if (!extras.every(isRect)) return;
  const first = octo === NOMINAL_OCTO;
  octo = pick(region.octo);
  extraRects = extras.map(pick);
  setInputRegion([octo, ...extraRects]);
  if (first) settle(); // the startup spot used a guessed box; clamp again with the real one
});
ipcMain.on('octo:move', (e, x, y) => {
  if (fromOverlay(e) && isInt(x, -1e5, 1e5) && isInt(y, -1e5, 1e5)) win.setPosition(x, y);
});
ipcMain.on('octo:drop', e => { if (fromOverlay(e)) settle(); });
ipcMain.on('dock:toggle', e => { if (fromOverlay(e)) toggleDock(); });

ipcMain.on('sim:pressure', (e, v) => {
  if (fromDock(e) && isNum(v, 0, 100)) {
    sim.setPressure(v, clock());
    if (bridgeConnected && bridgeWs?.readyState === WebSocket.OPEN) {
      bridgeWs.send(JSON.stringify({ cmd: 'pressure', value: v }));
    }
  }
});
ipcMain.on('sim:masti', e => {
  if (fromDock(e)) {
    sim.toggleMasti(clock());
    if (bridgeConnected && bridgeWs?.readyState === WebSocket.OPEN) {
      bridgeWs.send(JSON.stringify({ cmd: 'masti' }));
    }
  }
});
ipcMain.on('sim:demo', (e, on) => { if (fromDock(e) && typeof on === 'boolean') sim.setDemo(on, clock()); });
ipcMain.on('sim:temps', (e, t) => {
  if (fromDock(e) && isNum(t?.cpu, 20, 110) && isNum(t?.gpu, 20, 110)) temps = { cpu: t.cpu, gpu: t.gpu };
});
ipcMain.on('sim:emote', (e, name) => {
  if (fromDock(e) && typeof name === 'string' && /^\d\d_[a-z_]+$/.test(name)) {
    picked = { emote: name, until: clock() + 6 };
    if (bridgeConnected && bridgeWs?.readyState === WebSocket.OPEN) {
      bridgeWs.send(JSON.stringify({ cmd: 'emote', name, duration: 6 }));
    }
  }
});
ipcMain.on('sim:look', (e, l) => {
  if (fromDock(e) && (l === null || (isNum(l?.fx, 0, 1) && isNum(l?.fy, 0, 1)))) {
    look = l && { fx: l.fx, fy: l.fy };
    if (bridgeConnected && bridgeWs?.readyState === WebSocket.OPEN) {
      bridgeWs.send(JSON.stringify({ cmd: 'look', fx: l?.fx, fy: l?.fy }));
    }
  }
});
ipcMain.on('controls:set', (e, type, val) => {
  if (!fromOverlay(e) && !fromDock(e)) return;
  const endpoint = type === 'bluetooth' ? 'http://127.0.0.1:8765/controls/bluetooth'
    : type === 'wifi' ? 'http://127.0.0.1:8765/controls/wifi'
    : type === 'brightness' ? 'http://127.0.0.1:8765/controls/brightness'
    : null;
  if (!endpoint) return;
  const body = type === 'brightness' ? { percent: val } : { enabled: Boolean(val) };
  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
});
ipcMain.on('octo:play', (e, name) => {
  if (fromDock(e) && MOVE_NAMES.includes(name)) win?.webContents.send('octo:play', name);
});
ipcMain.handle('dock:moves', e => (fromDock(e) ? MOVE_NAMES : []));

app.whenReady().then(() => {
  createWindow();
  connectBridge();
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, () => win && settle());
  // Under XWayland this only fires while an X11 window has focus; the bridge's POST /masti
  // (Phase 4) is the fallback for a KDE custom shortcut.
  if (!globalShortcut.register(MASTI_KEY, () => sim.toggleMasti(clock()))) console.error(`could not register ${MASTI_KEY}`);
});
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
