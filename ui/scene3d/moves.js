// Procedural motion for the octo. Pure functions of time (no three.js), so node can test them.
// Units: voxels and radians. A pose is a set of changes from REST that Scene3D applies to the rig.

const TAU = Math.PI * 2;
export const REST = {
  x: 0, y: 0, rotX: 0, rotY: 0, rotZ: 0, squash: 1, legAmp: 1, legGait: 0, armR: 0,
  blink: false, eyes: null, zzz: false, eyeX: 0, eyeY: 0,
};
const BLEND = ['x', 'y', 'rotX', 'rotY', 'rotZ', 'squash', 'armR'];

const smooth = t => t * t * (3 - 2 * t);
const easeOut = t => 1 - (1 - t) ** 3;
const easeIn = t => t ** 3;
const easeInOut = t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const between = (t, a, b) => t > a && t < b;

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

// Gravity arc between launch and landing (fractions of the move), peak height h.
const arc = (t, from, to, h) => (between(t, from, to) ? 4 * h * ((t - from) / (to - from)) * (1 - (t - from) / (to - from)) : 0);
const envelope = t => keys(t, [[0, 0], [0.1, 1], [0.9, 1], [1, 0]]);

// One-shot moves (spec §3.4): anticipation -> action -> overshoot -> settle. pose(t in 0..1, dir)
// must be REST at t = 0 and t = 1 (rotations modulo a full turn) so moves chain without pops
// (tested). keepX: the move's final x becomes the octo's new resting spot.
export const MOVES = {
  jump: {
    dur: 0.95,
    pose: t => ({
      y: arc(t, 0.22, 0.7, 6),
      squash: keys(t, [[0, 1], [0.18, 0.78], [0.26, 1.2, easeOut], [0.45, 1], [0.66, 1.05],
        [0.74, 0.76, easeOut], [0.84, 1.08], [0.92, 0.97], [1, 1]]),
      legAmp: between(t, 0.22, 0.7) ? 3 : 1,
    }),
  },
  flipJump: { // jump + a full forward flip (task done after long work)
    dur: 1.3,
    pose: t => ({
      y: arc(t, 0.2, 0.74, 9),
      rotX: keys(t, [[0, 0], [0.24, 0], [0.7, -TAU, easeInOut], [1, -TAU]]),
      squash: keys(t, [[0, 1], [0.16, 0.75], [0.24, 1.22, easeOut], [0.4, 1], [0.7, 1.04],
        [0.78, 0.74, easeOut], [0.88, 1.08], [0.95, 0.97], [1, 1]]),
      legAmp: between(t, 0.2, 0.74) ? 3 : 1,
    }),
  },
  turnAround: {
    dur: 1.1,
    pose: t => ({
      rotY: keys(t, [[0, 0], [0.15, -0.3, easeOut], [0.8, TAU + 0.2, easeInOut], [1, TAU]]),
      y: keys(t, [[0, 0], [0.15, 0], [0.45, 1.2, easeOut], [0.75, 0, easeIn], [1, 0]]),
      squash: keys(t, [[0, 1], [0.15, 0.9], [0.3, 1.05], [0.75, 1], [0.82, 0.93], [1, 1]]),
    }),
  },
  peekTurn: { // 90° turn, glance over the shoulder, turn back (mood changes swap the face here)
    dur: 1.4,
    pose: t => ({
      rotY: keys(t, [[0, 0], [0.1, -0.12, easeOut], [0.35, 1.55, easeOut], [0.62, 1.55], [1, 0, easeInOut]]),
      rotZ: keys(t, [[0, 0], [0.38, 0], [0.48, 0.12], [0.58, 0], [1, 0]]),
      squash: keys(t, [[0, 1], [0.1, 0.94], [0.3, 1.02], [0.9, 1], [0.95, 0.97], [1, 1]]),
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
  tumble: { // forward roll, then sit up dizzy (after overdrive ends)
    dur: 2,
    pose: t => {
      const a = keys(t, [[0, 0], [0.1, -0.03, easeOut], [0.55, 1, easeInOut], [1, 1]]);
      return {
        rotX: -TAU * a,
        y: 1.6 * Math.abs(Math.sin(Math.PI * a)),
        rotZ: keys(t, [[0, 0], [0.55, 0], [0.65, 0.12], [0.75, -0.1], [0.85, 0.06], [0.95, -0.03], [1, 0]]),
        squash: keys(t, [[0, 1], [0.1, 0.9], [0.5, 1], [0.58, 0.8, easeOut], [0.66, 1.05], [0.75, 1], [1, 1]]),
        eyes: between(t, 0.55, 0.95) ? 'dizzy' : undefined,
      };
    },
  },
  walk: { // 8-leg wave gait with a waddle, turned towards where it goes
    dur: 2.4,
    keepX: true,
    pose: (t, dir = 1) => {
      const e = envelope(t);
      return {
        x: dir * 10 * keys(t, [[0, 0], [0.08, 0], [0.92, 1, smooth], [1, 1]]),
        y: 0.4 * e * Math.abs(Math.sin(TAU * 4 * t)),
        rotY: dir * 0.5 * e,
        rotZ: 0.08 * e * Math.sin(TAU * 4 * t),
        legGait: e,
      };
    },
  },
  shake: { // 1–2 px high-frequency jitter
    dur: 0.7,
    pose: t => ({ x: 0.15 * (1 - t) * Math.sin(TAU * 25 * t), rotZ: 0.03 * (1 - t) * Math.sin(TAU * 19 * t) }),
  },
  melt: { // squash down to 0.6 and spread, then reform (GPU too hot)
    dur: 2.6,
    pose: t => ({
      squash: keys(t, [[0, 1], [0.25, 0.6, easeOut], [0.65, 0.6], [0.8, 1.12, easeOut], [0.9, 0.95], [1, 1]]),
      y: keys(t, [[0, 0], [0.25, -0.3], [0.65, -0.3], [0.8, 0.2], [1, 0]]),
      eyes: between(t, 0.2, 0.72) ? 'sleepy' : undefined,
    }),
  },
  sleep: { // sinks lower, eyes – –, zZz (idle over 5 min; replayed while that lasts)
    dur: 6,
    pose: t => {
      const e = keys(t, [[0, 0], [0.12, 1], [0.88, 1], [1, 0]]);
      return {
        y: -0.8 * e,
        squash: 1 + 0.04 * e * Math.sin(TAU * 3 * t), // slow sleepy breathing
        eyes: between(t, 0.08, 0.92) ? 'sleepy' : undefined,
        zzz: between(t, 0.12, 0.88),
      };
    },
  },
  dance: { // rhythmic hops with alternating tilt (masti, music)
    dur: 2.4,
    pose: t => {
      const e = envelope(t);
      return {
        y: 1.4 * e * Math.abs(Math.sin(Math.PI * 4 * t)),
        rotZ: 0.16 * e * Math.sin(TAU * 2 * t),
        squash: 1 - 0.08 * e * Math.cos(TAU * 4 * t) * Math.sin(Math.PI * t),
        legAmp: 1 + 2 * e,
      };
    },
  },
  wave: { // one arm nub waves (app start)
    dur: 1.6,
    pose: t => ({
      armR: keys(t, [[0, 0], [0.15, 1.1, easeOut], [0.3, 0.6], [0.45, 1.1], [0.6, 0.6], [0.75, 1.1], [1, 0, easeInOut]]),
      rotZ: keys(t, [[0, 0], [0.15, 0.05], [0.75, 0.05], [1, 0]]),
    }),
  },
  bounce: { // landing after a drag-and-drop
    dur: 0.5,
    pose: t => ({ squash: keys(t, [[0, 1], [0.25, 0.78, easeOut], [0.5, 1.08], [0.75, 0.97], [1, 1]]) }),
  },
};

// Frame budget (spec §3.3): ~60 FPS while acting, ~24 when idle, on any display rate (this
// laptop's panel runs at 120 Hz: uncapped, a move drew 119 FPS). Returns the new deadline when
// this frame should draw, or null to skip. The deadline steps by 1/fps (not "1/fps since the
// last draw", which lands on every 3rd 60 Hz frame = 20 FPS); max() stops catch-up bursts.
export function frameGate(idle, now, deadline, idleFps = 24, activeFps = 60) {
  const fps = idle ? idleFps : activeFps;
  const slack = 0.002; // a 60 Hz frame can arrive a hair early; don't skip it
  if (now < deadline - slack) return null;
  return Math.max(deadline + 1 / fps, now - 1 / fps);
}

// Base layer (mood pose: bob, lean, tilt, bounce, jitter; breathing; blink; look-at; drag) plus a
// queue of one-shots on top. A mood change crossfades the pose over 0.4 s.
const CALM = { bobHz: 0.5, bobAmp: 0.35, lean: 0, tilt: 0, bounce: 0, jitter: 0 };
const MOOD_FADE = 0.4;
const LOOK_RATE = 4; // 1/s: how fast the gaze eases toward a new target

export function createPlayer(random = Math.random) {
  let moodFrom = CALM;
  let moodTo = CALM;
  let moodAt = -Infinity;
  let phase = 0; // bob phase, accumulated so a speed change never jumps
  let lastNow = null;
  const blendMood = now => {
    const k = smooth(Math.min(1, Math.max(0, (now - moodAt) / MOOD_FADE)));
    const m = {};
    for (const key of Object.keys(CALM)) m[key] = moodFrom[key] + (moodTo[key] - moodFrom[key]) * k;
    return m;
  };
  const look = { yaw: 0, ex: 0, ey: 0 };
  let lookTo = { yaw: 0, ex: 0, ey: 0 };
  let dragging = false;
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

    const dt = lastNow === null ? 0 : Math.min(0.1, Math.max(0, now - lastNow));
    lastNow = now;
    const m = blendMood(now);
    phase += TAU * m.bobHz * dt;
    const k = Math.min(1, dt * LOOK_RATE);
    for (const key of ['yaw', 'ex', 'ey']) look[key] += (lookTo[key] - look[key]) * k;
    const shake = () => m.jitter * (random() * 2 - 1);
    const p = {
      ...REST,
      x: offsetX + shake(),
      y: m.bobAmp * Math.sin(phase) + m.bounce * Math.abs(Math.sin(TAU * 3 * now)) + shake(), // idleBob
      rotX: m.lean,
      rotY: look.yaw,
      rotZ: m.tilt * (1 + 0.3 * Math.sin(2 * now)) + (dragging ? 0.12 * Math.sin(TAU * 1.5 * now) : 0),
      squash: 1 + 0.02 * Math.sin(TAU * 0.25 * now), // breathing
      legAmp: dragging ? 3.5 : 1, // dragFlail
      blink: now < blinkUntil,
      eyeX: look.ex,
      eyeY: look.ey,
    };
    if (cur) {
      const mv = MOVES[cur.name].pose((now - cur.start) / MOVES[cur.name].dur, cur.dir);
      p.x += mv.x ?? 0;
      p.y += mv.y ?? 0;
      p.rotX += mv.rotX ?? 0;
      p.rotY += mv.rotY ?? 0;
      p.rotZ += mv.rotZ ?? 0;
      p.squash *= mv.squash ?? 1;
      p.legAmp = Math.max(p.legAmp, mv.legAmp ?? 1);
      p.legGait = mv.legGait ?? 0;
      p.armR = mv.armR ?? 0;
      p.eyes = mv.eyes ?? null;
      p.zzz = mv.zzz ?? false;
    }
    if (from) {
      const f = (now - fromAt) / 0.25;
      if (f >= 1) from = null;
      else for (const key of BLEND) p[key] = from[key] + (p[key] - from[key]) * smooth(f);
    }
    return (last = p);
  }

  // Switch the base layer to a mood pose ({ bobHz, bobAmp, lean, tilt, bounce, jitter }).
  function setMood(pose, now) {
    moodFrom = blendMood(now);
    moodTo = { ...CALM, ...pose };
    moodAt = now;
  }

  // Gaze target: body yaw (radians) and eye shift (voxels); eased, never snapped.
  function setLook(yaw, ex, ey) {
    lookTo = { yaw, ex, ey };
  }

  // Legs flail while dragged; a squash bounce on drop.
  function setDragging(on, now) {
    if (dragging && !on) play('bounce', now);
    dragging = on;
  }

  const fading = () => lastNow !== null && lastNow - moodAt < MOOD_FADE; // keep 60 FPS through a mood crossfade
  const gazing = () => Math.abs(lookTo.yaw - look.yaw) > 0.01 || Math.abs(lookTo.ex - look.ex) > 0.02;
  return {
    play, pose, setMood, setLook, setDragging,
    busy: () => !!cur || queue.length > 0 || !!from || fading() || dragging || gazing(),
  };
}
