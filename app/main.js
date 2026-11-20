// Electron main: a transparent, always-on-top window that shows the octo. Clicks outside the
// octo fall through; drag moves it; the spot is remembered per display.
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nearestDisplay, clampOcto, toSaved, fromSaved } from './placement.js';

const here = dirname(fileURLToPath(import.meta.url));
const SIZE = { width: 460, height: 340 }; // room for a jump and a roll; empty space is click-through
const NOMINAL_OCTO = { x: 144, y: 128, width: 172, height: 157 }; // octo box at rest, until the page reports it

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
let octo = NOMINAL_OCTO;
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
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  startShaper();
  setInputRegion(null); // fully click-through until the page reports the octo
  win.once('ready-to-show', () => win.showInactive());
  win.loadFile(join(here, '../dist/overlay.html'));
}

// Click-through: the window's input region is the octo's box, so the compositor itself sends
// every click outside it to the window below. ponytail: not the spec's cursor polling; under
// XWayland, X11 apps don't see the cursor while it's over Wayland windows, so polling can't work.
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

function setInputRegion(r) {
  if (shaper) shaper.stdin.write(r ? `${r.x} ${r.y} ${r.width} ${r.height}\n` : '\n');
  else win.setShape(r ? [r] : []);
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

const fromPage = e => e.sender === win?.webContents;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

ipcMain.on('octo:rect', (e, r) => {
  if (!fromPage(e) || !r || !isInt(r.x, 0, SIZE.width) || !isInt(r.y, 0, SIZE.height)
    || !isInt(r.width, 1, SIZE.width - r.x) || !isInt(r.height, 1, SIZE.height - r.y)) return;
  octo = { x: r.x, y: r.y, width: r.width, height: r.height };
  setInputRegion(octo);
});
ipcMain.on('octo:move', (e, x, y) => {
  if (fromPage(e) && isInt(x, -1e5, 1e5) && isInt(y, -1e5, 1e5)) win.setPosition(x, y);
});
ipcMain.on('octo:drop', e => {
  if (fromPage(e)) settle();
});

app.whenReady().then(() => {
  createWindow();
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, () => win && settle());
});
app.on('window-all-closed', () => app.quit());
