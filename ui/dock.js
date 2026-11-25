// Simulator dock: drives the shared simulator in the main process and shows its state.
import '@fontsource/sora/latin-600.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './dock.css';
import { NAMES, moodOf } from './mood/mood.js';

const bridge = window.dockBridge; // from app/dock-preload.cjs
const $ = id => document.getElementById(id);
const SPRITES = import.meta.glob('../assets/emotes-clean/[0-9][0-9]_*.png', { eager: true, query: '?url', import: 'default' });
const MOODS = ['idle', 'light', 'deep', 'overdrive', 'masti'];
const label = name => name.slice(3).replace(/_/g, ' ');

let state = { p: 8, masti: false, demo: false };
let sliding = false; // don't fight the user's thumb with incoming state

// ---- pressure, moods, demo ----
const pressure = $('pressure');
pressure.addEventListener('input', () => { sliding = true; bridge.setPressure(+pressure.value); });
pressure.addEventListener('change', () => { sliding = false; });
$('moods').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'masti') bridge.toggleMasti();
  else bridge.setPressure(+b.dataset.p);
});
$('demo').addEventListener('click', () => bridge.setDemo(!state.demo));

// ---- move tester ----
bridge.moves().then(names => {
  for (const name of names) {
    const b = document.createElement('button');
    b.dataset.move = name;
    b.textContent = name;
    $('moves').append(b);
  }
});
$('moves').addEventListener('click', e => {
  const b = e.target.closest('[data-move]');
  if (b) bridge.play(b.dataset.move);
});

// ---- emote browser ----
for (const [path, url] of Object.entries(SPRITES).sort()) {
  const name = path.match(/(\d\d_[a-z_]+)\.png$/)[1];
  const b = document.createElement('button');
  b.dataset.emote = name;
  b.title = label(name);
  const img = document.createElement('img');
  img.src = url;
  img.alt = label(name);
  b.append(img);
  $('emotes').append(b);
}
$('emotes').addEventListener('click', e => {
  const b = e.target.closest('[data-emote]');
  if (b) bridge.showEmote(b.dataset.emote);
});

// ---- look target: where the terminal is (fake until the bridge finds it) ----
const map = $('screenmap');
map.style.setProperty('--ratio', `${screen.width} / ${screen.height}`);
function setLook(fx, fy) {
  bridge.setLook({ fx, fy });
  Object.assign($('dot').style, { left: `${fx * 100}%`, top: `${fy * 100}%` });
  $('dot').hidden = false;
  $('looknote').textContent = `Terminal at ${Math.round(fx * 100)} %, ${Math.round(fy * 100)} % of the screen`;
}
map.addEventListener('click', e => {
  const r = map.getBoundingClientRect();
  setLook(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
});
map.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLook(0.75, 0.4); } });
$('lookclear').addEventListener('click', () => {
  bridge.setLook(null);
  $('dot').hidden = true;
  $('looknote').textContent = 'Not set: the octo looks ahead.';
});

// ---- telemetry override ----
const SHOW = { cpu: v => `${v} °C`, gpu: v => `${v} °C`, bat: v => (v >= 100 ? '100 % plugged in' : `${v} % on battery`) };
for (const id of Object.keys(SHOW)) {
  $(id).addEventListener('input', () => {
    $(`${id}v`).textContent = SHOW[id](+$(id).value);
    bridge.setTemps({ cpu: +$('cpu').value, gpu: +$('gpu').value, battery: +$('bat').value });
  });
}

// ---- shared state from the main process (10 Hz while the dock is open) ----
const moodButtons = [...$('moods').children];
bridge.onState(s => {
  state = s;
  const m = moodOf(s.p, s.masti);
  $('pv').textContent = `${Math.round(s.p)}%`;
  $('mood').textContent = NAMES[m];
  if (!sliding) pressure.value = Math.round(s.p);
  $('demo').setAttribute('aria-pressed', String(Boolean(s.demo)));
  moodButtons.forEach((b, i) => b.classList.toggle('act', MOODS[i] === m));
});
