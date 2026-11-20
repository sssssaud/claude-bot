// Phase 1 test page: the 3D octo in a plain browser tab, with a button per move.
import model from '../voxels/octo.json';
import { createScene3D } from './scene3d/Scene3D.js';

// ?speed=0.1 plays every move in slow motion, to check timing frame by frame
const speed = Number(new URLSearchParams(location.search).get('speed'));
const octo = createScene3D(document.querySelector('#octo'), model, { speed: speed > 0 && speed <= 4 ? speed : 1 });

for (const button of document.querySelectorAll('[data-move]')) {
  button.addEventListener('click', () => octo.play(button.dataset.move));
}
document.querySelector('#outline').addEventListener('change', e => octo.setOutline(e.target.checked));

const stats = document.querySelector('#stats');
setInterval(() => {
  const s = octo.stats();
  stats.textContent = `${s.fps} fps · ${s.voxels} voxels · ${s.draws} draws`;
}, 500);
