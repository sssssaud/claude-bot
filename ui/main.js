// Browser test page: the companion with move buttons and simulator controls.
import model from '../voxels/octo.json';
import { createCompanion } from './companion.js';
import { createSimulator, NAMES, moodOf } from './mood/mood.js';
import { MOVES } from './scene3d/moves.js';

// ?speed=0.1 plays every move in slow motion, to check timing frame by frame
const speed = Number(new URLSearchParams(location.search).get('speed'));
const companion = createCompanion({
  canvas: document.querySelector('#octo'),
  layer: document.querySelector('#layer'),
  model,
  speed: speed > 0 && speed <= 4 ? speed : 1,
});
const octo = companion.scene;

for (const name of ['idle', 'blink', ...Object.keys(MOVES)]) {
  const b = document.createElement('button');
  b.textContent = name;
  b.addEventListener('click', () => octo.play(name));
  document.querySelector('#moves').append(b);
}
document.querySelector('#outline').addEventListener('change', e => octo.setOutline(e.target.checked));

const sim = createSimulator();
const now = () => performance.now() / 1000;
const pressure = document.querySelector('#pressure');
const demo = document.querySelector('#demo');
const label = document.querySelector('#mood');
pressure.addEventListener('input', () => { sim.setPressure(+pressure.value, now()); demo.checked = false; });
document.querySelector('#masti').addEventListener('click', () => { sim.toggleMasti(now()); demo.checked = false; });
demo.addEventListener('change', () => sim.setDemo(demo.checked, now()));

setInterval(() => {
  const s = sim.state(now());
  companion.update(s);
  if (s.demo) pressure.value = Math.round(s.p);
  label.textContent = NAMES[moodOf(s.p, s.masti)];
}, 100);

const stats = document.querySelector('#stats');
setInterval(() => {
  const s = octo.stats();
  stats.textContent = `${s.fps} fps · ${s.voxels} voxels · ${s.draws} draws`;
}, 500);
