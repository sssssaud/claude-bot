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
  drained: { bobHz: 0.25, bobAmp: 0.2, lean: 0.14, tilt: 0, bounce: 0, jitter: 0 }, // low battery: slow, head down
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
// Every emote of the pack as an expression ON the 3D octo (Saud 2026-11-23: the small 2D sticker didn't
// match the big octo, so it's gone): face decals + voxel props (octo.json prop.*) + particles.
const E = (eyes, mouth, more = {}) => ({ eyes, mouth, extras: [], props: [], particles: [], ...more });
export const EXPRESSIONS = {
  '01_hello': E('open', 'smile', { particles: ['sparkles'] }),
  '02_love': E('heart', 'smile', { extras: ['blush'], particles: ['hearts'] }),
  '03_hug_cat': E('happy', 'smile', { extras: ['blush'], particles: ['hearts'] }),
  '04_cool': E('open', 'smirk', { props: ['sunglasses'] }),
  '05_crying': E('closed', 'o', { extras: ['tears'] }),
  '06_laughing': E('happy', 'o', { extras: ['tears', 'blush'] }),
  '07_surprised': E('open', 'o', { particles: ['exclaim'] }),
  '08_confused': E('open', 'smirk', { particles: ['question'] }),
  '09_thinking': E('open', 'none', { particles: ['dots'] }),
  '10_idea': E('happy', 'smile', { props: ['bulb'] }),
  '11_angry': E('angry', 'grit', { extras: ['anger'] }),
  '12_music': E('closed', 'smile', { props: ['headphones'], particles: ['notes'] }),
  '13_gaming': E('angry', 'smirk', { props: ['headphones'] }),
  '14_coding': E('angry', 'none', { props: ['laptop'] }),
  '15_studying': E('open', 'none', { props: ['glasses'], particles: ['dots'] }),
  '16_reading': E('open', 'none', { props: ['glasses'] }),
  '17_workout': E('angry', 'grit', { extras: ['sweat'], props: ['headband'] }),
  '18_strong': E('happy', 'smirk', { extras: ['sweat'] }),
  '19_lifting': E('angry', 'grit', { extras: ['sweat', 'anger'] }),
  '20_cozy': E('sleepy', 'smile', { extras: ['blush'], particles: ['zzz'] }),
  '21_sick': E('sleepy', 'o', { extras: ['sweat'] }),
  '22_healing': E('happy', 'smile', { extras: ['blush'], particles: ['sparkles'] }),
  '23_low_battery': E('sleepy', 'none'),
  '24_full_battery': E('happy', 'smile', { particles: ['sparkles'] }),
  '25_cooking': E('happy', 'smile', { props: ['chefhat'] }),
  '26_boba': E('happy', 'o'),
  '27_burger': E('happy', 'o'),
  '28_chef': E('happy', 'smirk', { props: ['chefhat'] }),
  '29_coffee': E('sleepy', 'smile', { props: ['mug'] }),
  '30_raincoat': E('open', 'none', { particles: ['rain'] }),
  '31_rainy': E('sleepy', 'none', { particles: ['rain'] }),
  '32_snowy': E('closed', 'o', { extras: ['blush'], particles: ['snow'] }),
  '33_astronaut': E('open', 'o', { particles: ['sparkles'] }),
  '34_alien': E('open', 'smile', { props: ['antennae'] }),
  '35_cardboard_box': E('open', 'none'),
  '36_sprout': E('happy', 'smile', { props: ['sprout'] }),
  '37_cloud': E('sleepy', 'smile', { particles: ['sparkles'] }),
  '38_cycling': E('happy', 'smile', { extras: ['sweat'] }),
  '39_angel': E('happy', 'smile', { props: ['halo'], particles: ['sparkles'] }),
  '40_devil': E('angry', 'smirk', { props: ['horns'] }),
  '41_birthday': E('happy', 'o', { props: ['partyhat'], particles: ['sparkles'] }),
  '42_christmas': E('happy', 'smile', { props: ['santahat'], particles: ['snow'] }),
  '43_wizard': E('open', 'smirk', { props: ['wizardhat'], particles: ['sparkles'] }),
  '44_magic': E('happy', 'o', { particles: ['sparkles'] }),
  '45_ninja': E('angry', 'none', { props: ['ninjaband'] }),
  '46_traveler': E('open', 'smile', { props: ['strawhat'] }),
  '47_vr_gamer': E('open', 'o', { props: ['visor'] }),
  '48_guitar': E('closed', 'smile', { particles: ['notes'] }),
};
// ---- session moments (Saud's pick, 2026-11-25): the situation a session is in, as the bridge reports it
// (bridge/sessions.py). Faces made only of existing parts and unlike the 48 emotes. Each shows MOMENT_S, then
// rests for `every` s while the situation lasts, so a long situation never turns into a noisy octo.
// Friendly style; personalities restyle these next. ----
export const MOMENT_S = 8;
export const MOMENTS = {
  waiting_long: { face: E('angry', 'none', { particles: ['dots'] }), every: 20, move: 'shake' }, // you haven't answered
  context_full: { face: E('dizzy', 'o', { extras: ['blush'] }), every: 90, move: 'bounce' }, // its memory is nearly full
  long_turn: { face: E('sleepy', 'grit', { extras: ['sweat'] }), every: 90 }, // 10+ minutes on one task
  juggling: { face: E('happy', 'grit', { extras: ['sweat'], particles: ['sparkles'] }), every: 60 }, // 2+ sub-agents
  limit_near: { face: E('open', 'grit', { extras: ['sweat'] }), every: 120 }, // token limit 80 %+
};
// One octo's moment picker: call it with the session's moments (priority order) every frame; it returns the
// moment to show now, or null (none, or all resting).
export function momentPicker() {
  let showing = null;
  let until = 0;
  const restUntil = {};
  return (moments, now, restScale = 1) => { // restScale: the personality's (Calm rests longer)
    if (showing && now < until && moments.includes(showing)) return showing;
    showing = null;
    for (const m of moments) {
      if (MOMENTS[m] && now >= (restUntil[m] ?? -Infinity)) {
        showing = m;
        until = now + MOMENT_S;
        restUntil[m] = until + MOMENTS[m].every * restScale;
        return m;
      }
    }
    return null;
  };
}

export const EXPRESSION_S = 5; // a pool expression shows this long, then the mood's own face returns

export const emoteInterval = (random = Math.random) => 8 + 7 * random(); // seconds, 8–15
export function nextEmote(mood, current, random = Math.random, pools = EMOTES) {
  const options = (pools[mood] ?? EMOTES[mood]).filter(e => e !== current);
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
    // live pressure (Claude Code via the bridge): moves the mood but keeps masti, auto-masti and
    // the sleep timer, which setPressure() resets (it is a user action)
    feed(v) { if (!demo) p = Math.min(100, Math.max(0, v)); },
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

// ---- context emotes from temperatures and battery (spec §3.6) ----
export const TEMP = { cpuSick: 90, gpuHot: 83, cool: 45 }; // °C
export const LOW_BATTERY = 20; // %: "Battery under 20%, unplugged"
export const lowBattery = b => b?.plugged === false && b.percent < LOW_BATTERY;
export function contextEmote({ cpu, gpu } = {}, battery, mood) { // hot CPU > low battery > cold idle
  if (cpu > TEMP.cpuSick) return '21_sick';
  if (lowBattery(battery)) return '23_low_battery';
  if (cpu < TEMP.cool && gpu < TEMP.cool && mood === 'idle') return '32_snowy';
  return null;
}

export const FULL_BATTERY = 99; // %: some batteries never report exactly 100
// "Plugged in and full → 24 full_battery, small hop", once per charge: fires when a plugged-in battery reaches
// FULL_BATTERY, then re-arms only after unplugging or dropping under 95 %, so a laptop that lives on the
// charger doesn't celebrate all day. Not armed at start: already full when the app starts = no hop.
export function fullBatteryWatch() {
  let armed = false;
  return b => {
    if (!b) return false;
    if (b.plugged === false || b.percent < 95) armed = true;
    if (!armed || b.plugged !== true || b.percent < FULL_BATTERY) return false;
    armed = false;
    return true;
  };
}
export const gpuHot = ({ gpu } = {}) => gpu > TEMP.gpuHot; // sweat now, melt in Phase 3c

// ---- personalities (Saud's pick, 2026-11-25): the same session in three styles; Friendly is the default.
// emotes / moves: how a Claude Code reaction is restyled (missing = as is, null = no reaction);
// pools: a mood's emote pool (missing = the default EMOTES); emoteEvery / momentRest / fidget: multipliers for
// how often pool emotes, moments and idle fidgets come back (bigger = calmer). ----
export const PERSONALITIES = {
  friendly: {
    label: 'Friendly',
    emotes: { '05_crying': '18_strong', '08_confused': '09_thinking', '10_idea': '03_hug_cat' }, // encouraging; done = a hug
    moves: {},
    pools: { overdrive: ['18_strong', '19_lifting', '38_cycling'] }, // works hard, never angry
    emoteEvery: 1, momentRest: 1, fidget: 1,
  },
  dramatic: {
    label: 'Dramatic',
    emotes: { '08_confused': '05_crying', '10_idea': '41_birthday', '04_cool': '41_birthday' }, // cries at once; done = party
    moves: { jump: 'flipJump', bounce: 'tumble' },
    pools: { idle: ['20_cozy', '37_cloud', '31_rainy'], overdrive: ['11_angry', '19_lifting', '05_crying'] },
    emoteEvery: 0.6, momentRest: 0.5, fidget: 0.5,
  },
  calm: {
    label: 'Calm',
    emotes: { '05_crying': '09_thinking', '08_confused': '09_thinking', '40_devil': '07_surprised',
      '46_traveler': null, '44_magic': null, '22_healing': null }, // only what matters: errors, risky, needs you, done
    moves: { flipJump: 'bounce', jump: 'bounce', tumble: null, peekTurn: null, shake: null },
    pools: { idle: ['29_coffee'], light: ['16_reading'], deep: ['14_coding'], overdrive: ['18_strong'], masti: ['04_cool'] },
    emoteEvery: 2.5, momentRest: 3, fidget: 3,
  },
};
export const personalityOf = name => PERSONALITIES[name] ?? PERSONALITIES.friendly;
const swap = (table, key) => (key in table ? table[key] : key);
// a Claude Code reaction { emote, move } in this personality's style (either may become null: none)
export const restyle = (name, emote, move) => {
  const p = personalityOf(name);
  return { emote: swap(p.emotes, emote), move: move == null ? null : swap(p.moves, move) };
};

// ---- the octo's own feelings (bridge/feelings.py, Saud's pick 2026-11-25): they bend the personality's pools.
// Low energy → coffee and sleepy faces (and the drained pose); low happiness → gloomy ones; high → extra smiles. ----
export const FEEL = { low: 35, high: 85 };
export function feelingPools(pools, feel) {
  if (!feel) return pools; // feelings off (tray) or no session
  const out = {};
  for (const mood of Object.keys(EMOTES)) {
    const base = pools[mood] ?? EMOTES[mood];
    if (feel.energy < FEEL.low) out[mood] = ['29_coffee', '23_low_battery', base[0]];
    else if (feel.happiness < FEEL.low) out[mood] = ['31_rainy', '09_thinking', base[0]];
    else if (feel.happiness > FEEL.high) out[mood] = [...base, '06_laughing', '03_hug_cat'];
    else out[mood] = base;
  }
  return out;
}
