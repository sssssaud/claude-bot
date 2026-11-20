// Mood engine: pressure (0–100) + masti → mood, verbs, colours, poses, faces, emote pools.
// Pure and time-injected (node-testable). Numbers come from PROMPT.md §3.5/§4 and the approved
// preview (assets/reference/ui-preview.html).

export const NAMES = { idle: 'Idle / chill', light: 'Light work', deep: 'Deep coding', overdrive: 'Overdrive', masti: 'Masti mode' };

export const moodOf = (p, masti = false) =>
  masti ? 'masti' : p <= 15 ? 'idle' : p <= 45 ? 'light' : p <= 75 ? 'deep' : 'overdrive';

// ---- thinking verbs (spec §4) ----
export const VERBS = {
  chill: ['Percolating', 'Simmering', 'Daydreaming', 'Tinkering', 'Vibing', 'Brewing'],
  focus: ['Blooming', 'Seasoning', 'Weaving', 'Architecting', 'Synthesizing', 'Refactoring'],
  hot: ['Overclocking', 'Inferno-compiling', 'Hyper-threading', 'Crunching', 'Melting-silicon', 'Turbo-seasoning'],
  masti: ['Charming', 'Smooth-talking', 'Rizzing', 'Taking-a-breather'],
};
export const verbPool = (p, masti = false) => (masti ? 'masti' : p <= 30 ? 'chill' : p <= 70 ? 'focus' : 'hot');
export const verbInterval = p => 4 - 1.5 * Math.min(1, Math.max(0, p / 100)); // seconds: 4 at rest, 2.5 flat out
export function nextVerb(pool, current, random = Math.random) {
  const options = VERBS[pool].filter(v => v !== current);
  return options[Math.floor(random() * options.length)];
}

// ---- colours (spec §4): #E07A5F → #FF5500 → #FF1E00; masti swings #FF0055 ↔ #FF758F ----
export const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
export const toHex = c => `#${c.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
export const rgba = (c, a = 1) => `rgba(${c.map(v => Math.round(Math.min(255, Math.max(0, v)))).join(',')},${a})`;
const TERRA = hex('#E07A5F');
const ORANGE = hex('#FF5500');
const CRIMSON = hex('#FF1E00');
export const ROSE = hex('#FF0055');
export const PINK = hex('#FF758F');
export const heatColor = p => {
  const q = Math.min(100, Math.max(0, p));
  return q < 50 ? mix(TERRA, ORANGE, q / 50) : mix(ORANGE, CRIMSON, (q - 50) / 50);
};

// ---- octo pose and face per mood (spec §3.5; units: voxels, radians, Hz) ----
export const POSE = {
  idle: { bobHz: 0.35, bobAmp: 0.35, lean: 0, tilt: 0, bounce: 0, jitter: 0 },
  light: { bobHz: 0.5, bobAmp: 0.35, lean: 0.1, tilt: 0, bounce: 0, jitter: 0 }, // small forward lean
  deep: { bobHz: 0.6, bobAmp: 0.3, lean: 0.07, tilt: 0, bounce: 0.09, jitter: 0 }, // quick micro-bounce
  overdrive: { bobHz: 0.75, bobAmp: 0.25, lean: 0.04, tilt: 0, bounce: 0, jitter: 0.12 }, // 1–2 px shake
  masti: { bobHz: 0.45, bobAmp: 0.35, lean: 0, tilt: -0.14, bounce: 0, jitter: 0 }, // head tilt
};
export const FACE = {
  idle: { eyes: 'sleepy', mouth: 'smile', extras: [] },
  light: { eyes: 'open', mouth: 'none', extras: [] },
  deep: { eyes: 'angry', mouth: 'none', extras: [] }, // determined
  overdrive: { eyes: 'angry', mouth: 'grit', extras: ['sweat', 'anger'] },
  masti: { eyes: 'wink', mouth: 'smirk', extras: ['blush'] },
};

// ---- emote pools (spec §3.5, names as cut by tools/clean_emotes.py) ----
// 30 is a raincoat, not "sunny" (docs/STATUS.md), so idle uses 36_sprout in its place.
export const EMOTES = {
  idle: ['29_coffee', '20_cozy', '26_boba', '36_sprout'],
  light: ['09_thinking', '15_studying', '16_reading', '10_idea'],
  deep: ['14_coding', '25_cooking', '28_chef', '43_wizard'],
  overdrive: ['11_angry', '18_strong', '19_lifting'],
  masti: ['02_love', '06_laughing', '04_cool', '03_hug_cat', '39_angel', '40_devil'],
};
export const emoteInterval = (random = Math.random) => 8 + 7 * random(); // seconds, 8–15
export function nextEmote(mood, current, random = Math.random) {
  const options = EMOTES[mood].filter(e => e !== current);
  return options[Math.floor(random() * options.length)];
}

// ---- auto-demo: the preview's loop (idle → light → deep → overdrive → cool down → masti) ----
const DEMO = [[8, 5], [34, 5], [62, 6], [94, 7], [10, 3], [10, 6, true]]; // [pressure, hold s, masti]
const RAMP = 2.5; // seconds to ease into each step
export const DEMO_CYCLE = DEMO.reduce((s, [, hold]) => s + RAMP + hold, 0);
export function demoAt(t) {
  let u = ((t % DEMO_CYCLE) + DEMO_CYCLE) % DEMO_CYCLE;
  let from = DEMO.at(-1)[0];
  for (const [p, hold, masti = false] of DEMO) {
    if (u < RAMP + hold) {
      const k = Math.min(1, u / RAMP);
      const e = k < 0.5 ? 2 * k * k : 1 - (2 - 2 * k) ** 2 / 2;
      return { p: from + (p - from) * e, masti };
    }
    u -= RAMP + hold;
    from = p;
  }
  return { p: from, masti: false }; // unreachable: u < DEMO_CYCLE
}

// ---- simulator state (spec §3.5): pressure source, masti toggle; when idle, one auto-masti burst
// after 25 s, then sleep after 5 quiet minutes ----
export const AUTO_MASTI_AFTER = 25; // s of idle
export const AUTO_MASTI_FOR = 8; // s
export const SLEEP_AFTER = 300; // s of quiet
export function createSimulator() {
  let p = 8;
  let masti = false; // masti asked for (button / hotkey)
  let demo = false;
  let demoFrom = 0;
  let idleSince = 0;
  let autoUntil = -1; // auto-masti running until this time
  let autoDone = false; // one burst per quiet stretch
  const reset = now => { autoUntil = -1; autoDone = false; idleSince = now; };
  return {
    setPressure(v, now) { p = Math.min(100, Math.max(0, v)); demo = false; masti = false; reset(now); },
    toggleMasti(now) { masti = !masti; demo = false; reset(now); },
    setDemo(on, now) { demo = on; demoFrom = now; masti = false; reset(now); },
    state(now) {
      if (demo) return { ...demoAt(now - demoFrom), demo: true, sleepy: false };
      const idle = moodOf(p) === 'idle';
      if (!idle) reset(now);
      if (autoUntil >= 0 && now >= autoUntil) { autoUntil = -1; autoDone = true; }
      if (idle && !masti && !autoDone && autoUntil < 0 && now - idleSince >= AUTO_MASTI_AFTER) autoUntil = now + AUTO_MASTI_FOR;
      const sleepy = idle && !masti && autoUntil < 0 && now - idleSince >= SLEEP_AFTER;
      return { p, masti: masti || autoUntil >= 0, demo: false, sleepy };
    },
  };
}

// ---- context emotes from temperatures (spec §3.6; thresholds become config.yaml in Phase 4) ----
export const TEMP = { cpuSick: 90, gpuHot: 83, cool: 45 }; // °C
export function tempEmote({ cpu, gpu } = {}, mood) {
  if (cpu > TEMP.cpuSick) return '21_sick';
  if (cpu < TEMP.cool && gpu < TEMP.cool && mood === 'idle') return '32_snowy';
  return null;
}
export const gpuHot = ({ gpu } = {}) => gpu > TEMP.gpuHot; // sweat now, melt in Phase 3c
