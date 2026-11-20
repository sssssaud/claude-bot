// npm test: overlay placement maths (multi-monitor, clamping, saved fractions).
import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestDisplay, clampOcto, toSaved, fromSaved } from './placement.js';

const laptop = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1036 } };
const right = { id: 2, workArea: { x: 1920, y: 0, width: 2560, height: 1400 } };
const octo = { x: 144, y: 128, width: 172, height: 157 }; // octo box inside the 460x340 window

test('nearest display: most overlap wins, off-screen goes to the closest', () => {
  assert.equal(nearestDisplay({ x: 1800, y: 100, width: 460, height: 340 }, [laptop, right]).id, 2); // 340 px on the right
  assert.equal(nearestDisplay({ x: 1680, y: 100, width: 460, height: 340 }, [laptop, right]).id, 1); // 240 px laptop vs 220 right
  assert.equal(nearestDisplay({ x: -5000, y: 0, width: 460, height: 340 }, [laptop, right]).id, 1);
});

test('clamp keeps the octo (not the empty window) inside the work area', () => {
  const pos = clampOcto({ x: 1800, y: 900, width: 0 }, octo, laptop.workArea); // octo would poke out right + bottom
  assert.deepEqual(pos, { x: 1920 - 172 - 144, y: 1036 - 157 - 128 });
  assert.deepEqual(clampOcto({ x: -144, y: -128 }, octo, laptop.workArea), { x: -144, y: -128 }); // octo exactly at 0,0: window may hang off
});

test('saved position round-trips and survives a resolution change', () => {
  const pos = { x: 600, y: 400 };
  const saved = toSaved(pos, octo, laptop);
  assert.deepEqual(fromSaved(saved, octo, [laptop], 1), pos);
  const hd = { id: 1, workArea: { x: 0, y: 0, width: 1280, height: 680 } };
  const p = fromSaved(toSaved({ x: 1920 - 172 - 144, y: 0 }, octo, laptop), octo, [hd], 1); // was flush right
  assert.equal(p.x + octo.x + octo.width, 1280, 'still flush right');
});

test('missing display or no saved data falls back to the primary, bottom right', () => {
  const p = fromSaved({ displayId: 99, fx: 0.5, fy: 0.5 }, octo, [laptop, right], 2);
  assert.ok(p.x + octo.x >= 1920, 'on the primary (right) display');
  const d = fromSaved(null, octo, [laptop], 1);
  assert.equal(d.y + octo.y + octo.height, 1036, 'sits on the bottom edge');
  assert.ok(d.x + octo.x + octo.width <= 1920);
});
