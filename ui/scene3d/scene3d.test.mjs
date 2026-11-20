// npm test: model parsing + motion maths (no browser, no three.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseModel, exposedFaces } from './voxels.js';
import { MOVES, REST, squashScale, createPlayer, frameGate } from './moves.js';

const TAU = Math.PI * 2;
const model = JSON.parse(readFileSync(new URL('../../voxels/octo.json', import.meta.url)));
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const sameAngle = (a, b) => near(Math.cos(a), Math.cos(b)) && near(Math.sin(a), Math.sin(b));

test('octo.json parses, fits the voxel budget, has the parts the moves need', () => {
  const parts = parseModel(model);
  const total = Object.values(parts).reduce((n, p) => n + p.voxels.length, 0);
  assert.ok(total < 3000, `${total} voxels`);
  for (const name of ['body', 'eyes.open', 'eyes.closed', 'eyes.sleepy', 'eyes.angry', 'eyes.wink', 'mouth.grit', 'mouth.smirk', 'mouth.smile', 'extra.blush', 'extra.sweat', 'extra.anger']) assert.ok(parts[name], name);
  assert.equal(Object.keys(parts).filter(n => n.startsWith('leg')).length, 8);
  const keys = new Set(parts.body.voxels.map(v => `${v.x},${v.y},${v.z}`));
  assert.equal(keys.size, parts.body.voxels.length, 'duplicate body voxels');
});

test('parser rejects a character missing from the palette', () => {
  assert.throws(() => parseModel({ palette: { o: '#fff' }, parts: { p: { at: [0, 0, 0], slices: [['ox']] } } }), /'x'/);
});

test('buried faces are dropped', () => {
  const two = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }];
  assert.equal(exposedFaces(two).length, 10); // 2 cubes x 6 faces - the 2 that touch
  const cube = [];
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) cube.push({ x, y, z });
  assert.equal(exposedFaces(cube).length, 54); // only the 9 x 6 outer faces of a 3x3x3 block
});

test('every move starts and ends at rest', () => {
  for (const [name, move] of Object.entries(MOVES)) {
    for (const t of [0, 1]) {
      const p = { ...REST, ...move.pose(t, 1) };
      assert.ok(near(p.y, 0), `${name} y at t=${t}`);
      assert.ok(near(p.squash, 1), `${name} squash at t=${t}`);
      for (const r of ['rotX', 'rotY', 'rotZ']) assert.ok(sameAngle(p[r], 0), `${name} ${r} at t=${t}`);
      if (t === 0 || !move.keepX) assert.ok(near(p.x, 0), `${name} x at t=${t}`);
    }
  }
});

test('squash keeps volume', () => {
  for (const s of [0.6, 0.76, 1, 1.2]) assert.ok(near(squashScale(s).reduce((a, b) => a * b), 1));
});

test('frame budget: ~24 draws/s idle, ~60 while acting, on 60, 120 and 144 Hz displays', () => {
  const drawsPerSecond = (hz, idle) => {
    let deadline = 0;
    let draws = 0;
    for (let i = 0; i < hz * 10; i++) {
      const gate = frameGate(idle, i / hz, deadline, 24);
      if (gate !== null) { deadline = gate; draws++; }
    }
    return draws / 10;
  };
  for (const hz of [60, 120, 144]) {
    assert.ok(Math.abs(drawsPerSecond(hz, true) - 24) <= 0.5, `${hz} Hz idle: ${drawsPerSecond(hz, true)}`);
    assert.ok(Math.abs(drawsPerSecond(hz, false) - 60) <= 0.5, `${hz} Hz acting: ${drawsPerSecond(hz, false)}`);
  }
});

test('mood change crossfades: no pop in the pose, new pose reached after 0.4 s', () => {
  const player = createPlayer(() => 0.5);
  let prev = null;
  for (let t = 0; t < 3; t += 1 / 60) {
    if (Math.abs(t - 1) < 1e-9 || (t > 1 && t - 1 / 60 < 1)) player.setMood({ bobHz: 0.75, lean: 0.1, tilt: -0.14 }, t);
    const p = player.pose(t);
    if (prev) for (const k of ['y', 'rotX', 'rotZ']) assert.ok(Math.abs(p[k] - prev[k]) < 0.05, `${k} jumped at t=${t.toFixed(3)}`);
    prev = p;
  }
  assert.ok(Math.abs(prev.rotX - 0.1) < 1e-9, 'lean reached');
});

test('player: rolls alternate so the octo stays on stage, idle interrupts, clicks are capped', () => {
  const player = createPlayer(() => 0.5);
  let now = 0;
  const xs = [];
  for (let i = 0; i < 4; i++) {
    player.play('roll', now);
    player.pose(now);
    now += 2;
    xs.push(player.pose(now).x);
  }
  assert.deepEqual(xs, [14, 0, 14, 0]);

  player.play('jump', now);
  player.pose(now);
  player.play('idle', now + 0.3);
  assert.ok(player.busy(), 'still blending back');
  assert.ok(near(player.pose(now + 0.3 + 0.3).squash, 1, 0.03), 'back near rest after the blend');
  assert.ok(!player.busy());

  for (let i = 0; i < 10; i++) player.play('jump', now + 5);
  let moves = 0;
  for (let t = now + 5; t < now + 20; t += 0.05) if (player.pose(t).y > 2) { moves++; t += 0.9; }
  assert.equal(moves, 3, 'only three queued jumps play');
});
