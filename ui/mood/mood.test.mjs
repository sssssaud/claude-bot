// npm test: mood thresholds, verbs, colours, demo loop, auto-masti.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import {
  moodOf, verbPool, verbInterval, nextVerb, VERBS, heatColor, toHex, EMOTES, FACE, POSE,
  demoAt, DEMO_CYCLE, createSimulator, AUTO_MASTI_AFTER, AUTO_MASTI_FOR, SLEEP_AFTER,
} from './mood.js';

test('pressure → mood at the spec thresholds', () => {
  const at = [[0, 'idle'], [15, 'idle'], [16, 'light'], [45, 'light'], [46, 'deep'], [75, 'deep'], [76, 'overdrive'], [100, 'overdrive']];
  for (const [p, mood] of at) assert.equal(moodOf(p), mood, `p=${p}`);
  assert.equal(moodOf(90, true), 'masti');
});

test('verbs: pools by pressure, never the same twice, 4 s → 2.5 s', () => {
  assert.equal(verbPool(30), 'chill');
  assert.equal(verbPool(31), 'focus');
  assert.equal(verbPool(71), 'hot');
  assert.equal(verbPool(10, true), 'masti');
  for (let i = 0; i < 50; i++) assert.notEqual(nextVerb('chill', 'Vibing', Math.random), 'Vibing');
  assert.ok(VERBS.hot.includes(nextVerb('hot', null, () => 0.99)));
  assert.equal(verbInterval(0), 4);
  assert.equal(verbInterval(100), 2.5);
});

test('heat colour hits the spec stops', () => {
  assert.equal(toHex(heatColor(0)), '#E07A5F');
  assert.equal(toHex(heatColor(50)), '#FF5500');
  assert.equal(toHex(heatColor(100)), '#FF1E00');
  assert.equal(toHex(heatColor(250)), '#FF1E00', 'clamped');
});

test('every emote in the pools exists as a clean sprite; every mood has a pose and a face', () => {
  const files = new Set(readdirSync(new URL('../../assets/emotes-clean/', import.meta.url)));
  for (const [mood, pool] of Object.entries(EMOTES)) {
    for (const name of pool) assert.ok(files.has(`${name}.png`), `${mood}: ${name}`);
    assert.ok(POSE[mood] && FACE[mood], mood);
  }
});

test('demo loop: visits every mood, eases (no jumps), repeats', () => {
  const seen = new Set();
  let prev = demoAt(0).p;
  for (let t = 0; t < DEMO_CYCLE; t += 0.05) {
    const s = demoAt(t);
    seen.add(moodOf(s.p, s.masti));
    // fastest legit ease: 94 → 10 in 2.5 s peaks at ~67 points/s = 3.4 per 50 ms step; a real jump is 20+
    assert.ok(Math.abs(s.p - prev) < 5, `jump at t=${t.toFixed(2)}`);
    prev = s.p;
  }
  assert.deepEqual([...seen].sort(), ['deep', 'idle', 'light', 'masti', 'overdrive']);
  assert.deepEqual(demoAt(1.234), demoAt(1.234 + DEMO_CYCLE));
});

test('simulator: auto-masti after 25 s idle, for 8 s; pressure or a button cancels it', () => {
  const sim = createSimulator();
  sim.setPressure(5, 0);
  assert.equal(sim.state(AUTO_MASTI_AFTER - 0.1).masti, false);
  assert.equal(sim.state(AUTO_MASTI_AFTER).masti, true);
  assert.equal(sim.state(AUTO_MASTI_AFTER + AUTO_MASTI_FOR - 0.1).masti, true);
  assert.equal(sim.state(AUTO_MASTI_AFTER + AUTO_MASTI_FOR).masti, false);
  sim.setPressure(60, 100);
  assert.equal(sim.state(200).masti, false, 'never auto-masti while busy');
  sim.toggleMasti(200);
  assert.equal(sim.state(201).masti, true);
  sim.toggleMasti(202);
  assert.equal(sim.state(203).masti, false);
});

test('simulator: one auto-masti per quiet stretch, then sleepy after 5 quiet minutes', () => {
  const sim = createSimulator();
  sim.setPressure(5, 0);
  assert.equal(sim.state(AUTO_MASTI_AFTER + 1).masti, true);
  // the burst began at the first check after 25 s (t = 26) and lasts 8 s
  for (let t = AUTO_MASTI_AFTER + 1 + AUTO_MASTI_FOR; t < SLEEP_AFTER - 1; t += 1) assert.equal(sim.state(t).masti, false, `no second burst at ${t}`);
  assert.equal(sim.state(SLEEP_AFTER - 1).sleepy, false);
  assert.equal(sim.state(SLEEP_AFTER).sleepy, true);
  sim.setPressure(40, SLEEP_AFTER + 1);
  assert.equal(sim.state(SLEEP_AFTER + 2).sleepy, false, 'work wakes it');
});

test('simulator: live feed changes the mood without cancelling masti or the sleep timer', () => {
  const sim = createSimulator();
  sim.setPressure(5, 0);
  for (let t = 1; t < SLEEP_AFTER; t += 1) { sim.feed(3); sim.state(t); } // live feeds every second, auto-masti burst comes and goes
  assert.equal(sim.state(SLEEP_AFTER).sleepy, true, 'quiet feeds keep the idle clock running');
  sim.toggleMasti(400);
  sim.feed(60);
  assert.equal(sim.state(401).masti, true, 'feed never cancels masti');
  assert.equal(sim.state(401).p, 60);
  sim.setDemo(true, 402);
  sim.feed(99);
  assert.ok(sim.state(403).p < 99, 'auto-demo wins over live data');
});
