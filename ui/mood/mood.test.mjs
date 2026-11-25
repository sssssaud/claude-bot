// npm test: mood thresholds, verbs, colours, demo loop, auto-masti.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PARTICLE_KINDS } from '../scene3d/particles.js';
import { MOVES } from '../scene3d/moves.js';
import {
  moodOf, verbPool, verbInterval, nextVerb, VERBS, heatColor, toHex, EMOTES, FACE, POSE, EXPRESSIONS,
  demoAt, DEMO_CYCLE, createSimulator, AUTO_MASTI_AFTER, AUTO_MASTI_FOR, SLEEP_AFTER, contextEmote, lowBattery, fullBatteryWatch, MOMENTS, MOMENT_S, momentPicker, gpuHot,
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

test('every one of the 48 emotes is an expression made only of parts and particles that exist', () => {
  const names = readdirSync(new URL('../../assets/emotes-clean/', import.meta.url)).filter(f => /^\d\d_.*\.png$/.test(f)).map(f => f.slice(0, -4));
  assert.equal(names.length, 48);
  assert.deepEqual(Object.keys(EXPRESSIONS).sort(), names.sort());
  const parts = new Set(Object.keys(JSON.parse(readFileSync(new URL('../../voxels/octo.json', import.meta.url))).parts));
  for (const [name, x] of Object.entries(EXPRESSIONS)) {
    assert.ok(parts.has(`eyes.${x.eyes}`), `${name}: eyes.${x.eyes}`);
    assert.ok(x.mouth === 'none' || parts.has(`mouth.${x.mouth}`), `${name}: mouth.${x.mouth}`);
    for (const e of x.extras) assert.ok(parts.has(`extra.${e}`), `${name}: extra.${e}`);
    for (const pr of x.props) assert.ok(parts.has(`prop.${pr}`), `${name}: prop.${pr}`);
    for (const pa of x.particles) assert.ok(PARTICLE_KINDS.includes(pa), `${name}: particle ${pa}`);
  }
  const used = new Set(Object.values(EXPRESSIONS).flatMap(x => x.props));
  for (const part of parts) if (part.startsWith('prop.')) assert.ok(used.has(part.slice(5)), `${part} is never used`);
});

test('temperature and battery emotes follow spec 3.6', () => {
  assert.equal(contextEmote({ cpu: 95, gpu: 50 }, null, 'deep'), '21_sick');
  assert.equal(contextEmote({ cpu: 40, gpu: 40 }, null, 'idle'), '32_snowy');
  assert.equal(contextEmote({ cpu: 40, gpu: 40 }, null, 'deep'), null, 'snowy only when idle');
  assert.equal(contextEmote({ cpu: 60, gpu: 60 }, undefined, 'idle'), null);
  const low = { percent: 15, plugged: false };
  assert.equal(contextEmote({ cpu: 60, gpu: 60 }, low, 'deep'), '23_low_battery');
  assert.equal(contextEmote({ cpu: 40, gpu: 40 }, low, 'idle'), '23_low_battery', 'low battery beats snowy');
  assert.equal(contextEmote({ cpu: 95, gpu: 50 }, low, 'idle'), '21_sick', 'a hot CPU beats low battery');
  assert.equal(lowBattery({ percent: 15, plugged: true }), false, 'charging: fine');
  assert.equal(lowBattery({ percent: 20, plugged: false }), false, '"under 20 %"');
  assert.equal(lowBattery({ percent: 19.9, plugged: false }), true);
  assert.equal(lowBattery(null) || lowBattery({}), false, 'no battery reading: no reaction');
  assert.equal(gpuHot({ gpu: 84 }), true);
  assert.equal(gpuHot({ gpu: 83 }), false);
});

test('full battery celebrates once per charge, not all day on the charger', () => {
  const at = (percent, plugged) => ({ percent, plugged });
  let w = fullBatteryWatch();
  assert.equal(w(at(100, true)), false, 'already full when the app starts: no hop');
  assert.deepEqual([at(60, true), at(98, true), at(99, true), at(100, true), at(99, true), at(100, true)].map(w),
    [false, false, true, false, false, false], 'charging up: one hop at 99 %, none while it trickles 99 ↔ 100');
  assert.deepEqual([at(100, false), at(100, true)].map(w), [false, true], 'unplug, plug back in full: hop again');
  w = fullBatteryWatch();
  assert.deepEqual([at(50, false), at(100, null), null].map(w), [false, false, false], 'plugged unknown / no reading: never');
});

test('session moments: real parts, real moves, one at a time, then rest', () => {
  const parts = new Set(Object.keys(JSON.parse(readFileSync(new URL('../../voxels/octo.json', import.meta.url))).parts));
  const emoteFaces = new Set(Object.values(EXPRESSIONS).map(x => JSON.stringify(x)));
  for (const [name, { face, move, every }] of Object.entries(MOMENTS)) {
    assert.ok(parts.has(`eyes.${face.eyes}`) && (face.mouth === 'none' || parts.has(`mouth.${face.mouth}`)), name);
    for (const e of face.extras) assert.ok(parts.has(`extra.${e}`), `${name}: extra.${e}`);
    for (const pa of face.particles) assert.ok(PARTICLE_KINDS.includes(pa), `${name}: particle ${pa}`);
    assert.ok(!emoteFaces.has(JSON.stringify(face)), `${name} looks like one of the 48 emotes`);
    assert.ok(move === undefined || move in MOVES, `${name}: move ${move}`);
    assert.ok(every >= 20, `${name}: rests at least 20 s`);
  }
  const pick = momentPicker();
  assert.equal(pick([], 0), null);
  assert.equal(pick(['juggling', 'limit_near'], 0), 'juggling', 'first = highest priority');
  assert.equal(pick(['juggling', 'limit_near'], MOMENT_S - 0.1), 'juggling', 'stays for MOMENT_S');
  assert.equal(pick(['juggling', 'limit_near'], MOMENT_S), 'limit_near', 'then the next one, juggling rests');
  assert.equal(pick(['juggling'], MOMENT_S + 1), null, 'situation over or resting: nothing');
  assert.equal(pick(['juggling'], 2 * MOMENT_S + MOMENTS.juggling.every), 'juggling', 'back after its rest');
  const p2 = momentPicker();
  p2(['waiting_long'], 0);
  assert.equal(p2([], 1), null, 'answered: the impatient face goes at once');
});
