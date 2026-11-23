// The desktop overlay page (loaded by Electron): octo + badge + emote sticker + popup panel (Phase 4).
// Click the octo = turnAround + toggle popup panel; drag = move the window; click the badge = simulator dock.
import model from '../voxels/octo.json';
import { createCompanion } from './companion.js';

const bridge = window.octoBridge; // from app/preload.cjs
const canvas = document.querySelector('#octo');
const companion = createCompanion({
  canvas, layer: document.querySelector('#layer'), model, orbit: false,
  onRegion: bridge.setRegion, onBadgeClick: bridge.toggleDock,
  onControl: (type, val) => bridge.setControl(type, val),
});
const octo = companion.scene;
window.__octo = octo; // dev handle for checks over the debug port; the page has no other API
window.__companion = companion;

// state comes from the main process (simulator fallback, bridge in Phase 4); the dock sends moves
bridge.onState(state => { window.__state = state; companion.update(state); }); // __state: dev handle
bridge.onPlay(name => octo.play(name));
bridge.onNotice(text => companion.notify(text)); // e.g. a quick control failed

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
  if (!press.dragging) octo.setDragging(true); // legs flail while dragged
  press.dragging = true;
  bridge.moveTo(Math.round(e.screenX - press.cx), Math.round(e.screenY - press.cy));
});
const release = e => {
  if (!press) return;
  if (press.dragging) {
    octo.setDragging(false); // squash bounce on drop
    bridge.drop();
  }
  else if (e.type === 'pointerup') {
    octo.play('turnAround');
    companion.togglePopup();
  }
  press = null;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
