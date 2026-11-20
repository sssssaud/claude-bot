// The desktop overlay page (loaded by Electron): octo + badge + emote sticker, no controls.
// Click = turnAround (spec 3.4); press and drag = move the window.
import model from '../voxels/octo.json';
import { createCompanion } from './companion.js';
import { createSimulator } from './mood/mood.js';

const bridge = window.octoBridge; // from app/preload.cjs
const canvas = document.querySelector('#octo');
const companion = createCompanion({ canvas, layer: document.querySelector('#layer'), model, orbit: false, onRect: bridge.setRect });
const octo = companion.scene;
window.__octo = octo; // dev handle for checks over the debug port; the page has no other API

// ponytail: until the simulator dock (Phase 3b) and the bridge (Phase 4) exist, the auto-demo drives it
const sim = createSimulator();
const now = () => performance.now() / 1000;
sim.setDemo(true, now());
setInterval(() => companion.update(sim.state(now())), 100);
window.__sim = { sim, now }; // dev handle: drive moods over the debug port

const DRAG_PX = 4; // less movement than this between press and release is a click
let press = null;

canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  press = { sx: e.screenX, sy: e.screenY, cx: e.clientX, cy: e.clientY, dragging: false };
});
canvas.addEventListener('pointermove', e => {
  if (!press) return;
  if (!press.dragging && Math.hypot(e.screenX - press.sx, e.screenY - press.sy) < DRAG_PX) return;
  press.dragging = true;
  bridge.moveTo(Math.round(e.screenX - press.cx), Math.round(e.screenY - press.cy));
});
const release = e => {
  if (!press) return;
  if (press.dragging) bridge.drop();
  else if (e.type === 'pointerup') octo.play('turnAround');
  press = null;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
