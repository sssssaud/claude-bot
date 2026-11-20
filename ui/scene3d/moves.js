// Procedural motion for the octo. Pure functions of time (no three.js), so node can test them.
// Units: voxels and radians. A pose is a set of changes from REST that Scene3D applies to the rig.

const TAU = Math.PI * 2;
export const REST = { x: 0, y: 0, rotX: 0, rotY: 0, rotZ: 0, squash: 1, legAmp: 1, eyes: 'open' };
const BLEND = ['x', 'y', 'rotX', 'rotY', 'rotZ', 'squash'];

const smooth = t => t * t * (3 - 2 * t);
const easeOut = t => 1 - (1 - t) ** 3;
const easeIn = t => t ** 3;
const easeInOut = t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// keys(t, [[t0, v0], [t1, v1, ease], ...]): `ease` shapes the segment that ends at that key.
export function keys(t, frames) {
  for (let i = 1; i < frames.length; i++) {
    const [t0, v0] = frames[i - 1];
    const [t1, v1, ease = smooth] = frames[i];
    if (t <= t1) return v0 + (v1 - v0) * ease((t - t0) / (t1 - t0));
  }
  return frames.at(-1)[1];
}

// Squash and stretch that keeps the volume: y by s, x and z by 1/sqrt(s).
export const squashScale = s => [1 / Math.sqrt(s), s, 1 / Math.sqrt(s)];

// One-shot moves: anticipation -> action -> overshoot -> settle. pose(t in 0..1, dir) must be
// REST at t = 0 and t = 1 (rotations modulo a full turn) so moves chain without pops (tested).
// keepX: the move's final x becomes the octo's new resting spot.
export const MOVES = {
  jump: {
    dur: 0.95,
    pose: t => {
      const air = t > 0.22 && t < 0.7 ? (t - 0.22) / 0.48 : -1;
      return {
        y: air >= 0 ? 24 * air * (1 - air) : 0, // gravity arc, peak 6 voxels
        squash: keys(t, [[0, 1], [0.18, 0.78], [0.26, 1.2, easeOut], [0.45, 1], [0.66, 1.05],
          [0.74, 0.76, easeOut], [0.84, 1.08], [0.92, 0.97], [1, 1]]),
        legAmp: air >= 0 ? 3 : 1,
      };
    },
  },
  turnAround: {
    dur: 1.1,
    pose: t => ({
      rotY: keys(t, [[0, 0], [0.15, -0.3, easeOut], [0.8, TAU + 0.2, easeInOut], [1, TAU]]),
      y: keys(t, [[0, 0], [0.15, 0], [0.45, 1.2, easeOut], [0.75, 0, easeIn], [1, 0]]),
      squash: keys(t, [[0, 1], [0.15, 0.9], [0.3, 1.05], [0.75, 1], [0.82, 0.93], [1, 1]]),
    }),
  },
  roll: {
    dur: 1.25,
    keepX: true,
    pose: (t, dir = 1) => {
      const a = keys(t, [[0, 0], [0.15, -0.08, easeOut], [0.85, 1.03, easeInOut], [1, 1]]);
      return {
        x: dir * 14 * a, // ~1.2 body widths
        rotZ: -dir * TAU * a,
        y: 1.5 * Math.abs(Math.sin(TAU * a)) + 1.5 * Math.abs(Math.sin(TAU * a / 2)), // clear the floor mid-roll
        squash: keys(t, [[0, 1], [0.15, 0.88], [0.25, 1], [0.88, 1], [0.93, 0.9], [1, 1]]),
      };
    },
  },
};

// Frame budget: every display frame while acting, ~`fps` when idle. Returns the new deadline
// when this frame should draw, or null to skip. The deadline steps by 1/fps (not "1/fps since
// the last draw", which lands on every 3rd 60 Hz frame = 20 FPS); max() stops catch-up bursts.
export function frameGate(idle, now, deadline, fps = 24) {
  if (!idle) return now;
  if (now < deadline) return null;
  return Math.max(deadline + 1 / fps, now - 1 / fps);
}

// Base layer (bob, breathing, blink) plus a queue of one-shots on top.
export function createPlayer(random = Math.random) {
  const queue = [];
  let cur = null; // { name, start, dir }
  let offsetX = 0;
  let blinkUntil = 0;
  let nextBlink = 3 + 2 * random();
  let from = null; // pose to blend away from after an interrupt
  let fromAt = 0;
  let last = { ...REST };

  function play(name, now) {
    if (name === 'blink') { blinkUntil = now + 0.12; return; }
    if (name === 'idle') { // interrupt: drop everything and ease back to rest
      queue.length = 0;
      if (cur) {
        from = { ...last, rotX: wrap(last.rotX), rotY: wrap(last.rotY), rotZ: wrap(last.rotZ) };
        fromAt = now;
        cur = null;
      }
      return;
    }
    if (!MOVES[name]) throw new Error(`unknown move: ${name}`);
    if (queue.length < 3) queue.push(name); // ponytail: extra clicks are dropped, not backlogged
  }

  function pose(now) {
    if (cur && now - cur.start >= MOVES[cur.name].dur) {
      if (MOVES[cur.name].keepX) offsetX += MOVES[cur.name].pose(1, cur.dir).x;
      cur = null;
    }
    if (!cur && queue.length) cur = { name: queue.shift(), start: now, dir: offsetX > 0 ? -1 : 1 };
    if (now >= nextBlink) { blinkUntil = now + 0.12; nextBlink = now + 3 + 2 * random(); }

    const p = {
      ...REST,
      x: offsetX,
      y: 0.35 * Math.sin(TAU * 0.5 * now), // idleBob
      squash: 1 + 0.02 * Math.sin(TAU * 0.25 * now), // breathing
      eyes: now < blinkUntil ? 'closed' : 'open',
    };
    if (cur) {
      const m = MOVES[cur.name].pose((now - cur.start) / MOVES[cur.name].dur, cur.dir);
      p.x += m.x ?? 0;
      p.y += m.y ?? 0;
      p.rotX = m.rotX ?? 0;
      p.rotY = m.rotY ?? 0;
      p.rotZ = m.rotZ ?? 0;
      p.squash *= m.squash ?? 1;
      p.legAmp = m.legAmp ?? 1;
    }
    if (from) {
      const k = (now - fromAt) / 0.25;
      if (k >= 1) from = null;
      else for (const key of BLEND) p[key] = from[key] + (p[key] - from[key]) * smooth(k);
    }
    return (last = p);
  }

  return { play, pose, busy: () => !!cur || queue.length > 0 || !!from };
}
