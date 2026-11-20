// npm test: mock keyboard effects + temperature emotes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { zoneColor, stepZones, EFFECTS } from './keyboard.js';
import { tempEmote, gpuHot } from './mood.js';

const lum = c => c[0] + c[1] + c[2];
const valid = c => c.length === 3 && c.every(v => v >= 0 && v <= 255);

test('every mood gives valid colours for all 4 zones', () => {
  for (const mood of Object.keys(EFFECTS)) {
    for (let t = 0; t < 6; t += 0.37) for (let z = 0; z < 4; z++) assert.ok(valid(zoneColor(mood, t, z, () => 0.5)), `${mood} t=${t}`);
  }
});

test('idle breathes at 0.2 Hz, overdrive beats at 1.5 Hz, masti waves across zones', () => {
  const idle = t => lum(zoneColor('idle', t, 0));
  assert.ok(idle(1.25) > 3 * idle(3.75), 'bright at the top of the breath, dim at the bottom');
  assert.ok(Math.abs(idle(1) - idle(6)) < 1e-6, 'period 5 s');
  const beat = t => lum(zoneColor('overdrive', t, 0, () => 1));
  assert.ok(beat(0) > 2 * beat(0.45), 'beat peak vs rest');
  assert.ok(Math.abs(beat(0.1) - beat(0.1 + 2 / 1.5)) < 1e-6, 'period 1/1.5 s');
  const m = zoneColor('masti', 0, 0);
  assert.notDeepEqual(m, zoneColor('masti', 0, 2), 'zones differ: a wave, not a flat fill');
});

test('a write eases toward the target instead of jumping', () => {
  const [z] = stepZones([[0, 0, 0]], 'light', 0);
  const target = zoneColor('light', 0, 0);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(z[i] - target[i] * 0.35) < 1e-9);
});

test('temperature emotes follow spec 3.6', () => {
  assert.equal(tempEmote({ cpu: 95, gpu: 50 }, 'deep'), '21_sick');
  assert.equal(tempEmote({ cpu: 40, gpu: 40 }, 'idle'), '32_snowy');
  assert.equal(tempEmote({ cpu: 40, gpu: 40 }, 'deep'), null, 'snowy only when idle');
  assert.equal(tempEmote({ cpu: 60, gpu: 60 }, 'idle'), null);
  assert.equal(gpuHot({ gpu: 84 }), true);
  assert.equal(gpuHot({ gpu: 83 }), false);
});
