// Pixel-art particles in the octo's own WebGL pass (no extra compositor layers, and the sticker
// outline pass gives them the same white border): zZz, { } and </> glyphs, sparks, sweat drops,
// steam, hearts, sparkles, embers, plus the crimson aura ring (spec §3.5).
import * as THREE from 'three';

const TAU = Math.PI * 2;
const MAX = 80;
const BITMAPS = { // '#' = colour
  z: ['#####', '...#.', '..#..', '.#...', '#####'],
  heart: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'],
  sparkle: ['..#..', '..#..', '#####', '..#..', '..#..'],
  drop: ['.#.', '###', '###', '.#.'],
  dot: ['##', '##'],
  puff: ['.##.', '####', '####', '.##.'],
};
// 3×5 pixel characters for the orbiting code glyphs. Hard-edged like every other particle:
// anti-aliased text turned into fuzzy white blobs under the sticker outline pass (seen in 3c).
const CHARS = {
  '<': ['..#', '.#.', '#..', '.#.', '..#'], '/': ['..#', '..#', '.#.', '#..', '#..'],
  '>': ['#..', '.#.', '..#', '.#.', '#..'], '{': ['.##', '.#.', '#..', '.#.', '.##'],
  '}': ['##.', '.#.', '..#', '.#.', '##.'], ' ': ['...', '...', '...', '...', '...'],
};
const glyphRows = label => CHARS['<'].map((_, y) => [...label].map(ch => CHARS[ch][y]).join('.'));
// emissions per second and how each kind moves (positions in voxels around the octo's centre)
const RATE = { zzz: 0.7, sparks: 5, sweat: 3, steam: 4, hearts: 1.8, sparkles: 3.5, embers: 6 };

function bitmap(rows, colour) {
  const c = document.createElement('canvas');
  c.width = rows[0].length;
  c.height = rows.length;
  const ctx = c.getContext('2d');
  ctx.fillStyle = colour;
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && ctx.fillRect(x, y, 1, 1)));
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// `flat` is drawn after the outline pass (no sticker border): for thin glyphs the border would swamp.
export function createParticles(scene, flat, random = Math.random) {
  const tex = {
    z: bitmap(BITMAPS.z, '#f6d3c4'),
    heart: bitmap(BITMAPS.heart, '#ff5c8a'),
    heart2: bitmap(BITMAPS.heart, '#ff9fb6'),
    sparkle: bitmap(BITMAPS.sparkle, '#ffd166'),
    sparkle2: bitmap(BITMAPS.sparkle, '#ffb3c7'),
    drop: bitmap(BITMAPS.drop, '#86ccff'),
    spark: bitmap(BITMAPS.dot, '#ffb347'),
    ember: bitmap(BITMAPS.dot, '#ff5a1f'),
    puff: bitmap(BITMAPS.puff, '#ffffff'),
  };
  const pool = Array.from({ length: MAX }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    s.visible = false;
    scene.add(s);
    return s;
  });
  const live = [];

  // persistent bits: two orbiting code glyphs (light work) and the aura ring (overdrive)
  const glyphs = ['{ }', '</>'].map(label => {
    const rows = glyphRows(label);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: bitmap(rows, '#ff9b7a'), transparent: true, depthWrite: false }));
    s.scale.set(rows[0].length * 0.4, rows.length * 0.4, 1); // 0.4 voxel per bitmap pixel
    s.visible = false;
    flat.add(s);
    return s;
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(9, 10.2, 48),
    new THREE.MeshBasicMaterial({ color: '#FF1E00', transparent: true, opacity: 0, depthWrite: false }));
  ring.visible = false;
  scene.add(ring);

  const acc = {};
  const rnd = (a, b) => a + (b - a) * random();
  function spawn(map, x, y, vx, vy, life, size, gravity = 0, maxOpacity = 1) {
    const s = pool.pop();
    if (!s) return; // pool full: skip, never allocate per frame
    s.material.map = map;
    s.material.opacity = maxOpacity;
    s.material.needsUpdate = true;
    s.position.set(x, y, 5); // in front of the body
    s.scale.set(size, size, 1);
    s.visible = true;
    live.push({ s, vx, vy, life, max: life, gravity, maxOpacity, wobble: rnd(0, TAU) });
  }

  // want: { zzz, glyphs, sparks, sweat, steam, aura, hearts, sparkles, embers }; c = octo centre
  function update(dt, t, c, want) {
    const emit = (kind, fn) => {
      if (!want[kind]) { acc[kind] = 0; return; }
      acc[kind] = (acc[kind] ?? 0) + RATE[kind] * dt;
      for (; acc[kind] >= 1; acc[kind]--) fn();
    };
    emit('zzz', () => spawn(tex.z, c.x + 4, c.y + 5, 1.4, 2.2, 2.2, rnd(1.1, 1.6)));
    emit('sparks', () => { const a = rnd(0, TAU); spawn(tex.spark, c.x + Math.cos(a) * 7, c.y + Math.sin(a) * 6, Math.cos(a) * 4, Math.sin(a) * 4, 0.6, 0.5); });
    emit('sweat', () => { const side = random() < 0.5 ? -1 : 1; spawn(tex.drop, c.x + side * 6, c.y + 3, side * rnd(5, 8), rnd(3, 6), 0.9, 0.9, 26); });
    emit('steam', () => spawn(tex.puff, c.x + rnd(-2, 2), c.y + 6, rnd(-1.5, 1.5), rnd(4.5, 7), 1, 1.2, 0, 0.45));
    emit('hearts', () => spawn(random() < 0.5 ? tex.heart : tex.heart2, c.x + rnd(-7, 7), c.y + rnd(-3, 4), rnd(-0.8, 0.8), rnd(2.6, 3.8), 2, rnd(1.4, 1.9)));
    emit('sparkles', () => { const a = rnd(0, TAU), r = rnd(8, 10.5); spawn(random() < 0.5 ? tex.sparkle : tex.sparkle2, c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, 0, -0.8, 0.9, rnd(0.9, 1.3)); });
    emit('embers', () => spawn(tex.ember, c.x + rnd(-5, 5), c.y + 5, rnd(-1, 1), rnd(4, 7), 1.2, 0.45));

    for (let i = live.length - 1; i >= 0; i--) {
      const q = live[i];
      q.life -= dt;
      if (q.life <= 0) {
        q.s.visible = false;
        pool.push(q.s);
        live.splice(i, 1);
        continue;
      }
      q.vy -= q.gravity * dt;
      q.s.position.x += (q.vx + Math.sin(t * 2 + q.wobble) * 0.4) * dt;
      q.s.position.y += q.vy * dt;
      const a = q.life / q.max;
      q.s.material.opacity = q.maxOpacity * Math.min(1, a * 1.6);
    }

    glyphs.forEach((g, i) => {
      g.visible = !!want.glyphs;
      if (!g.visible) return;
      const a = t * 1.3 + i * Math.PI;
      g.position.set(c.x + Math.cos(a) * 9, c.y + 4 + Math.sin(a) * 2.5, Math.sin(a) * 6);
      g.material.opacity = 0.55 + 0.45 * (Math.sin(a) + 1) / 2;
    });

    ring.visible = !!want.aura;
    if (ring.visible) { // crimson ring, beating at 1.5 Hz; kept under 0.5 opacity so the outline pass ignores it
      const beat = Math.max(0, Math.sin(t * Math.PI * 3));
      ring.position.set(c.x, c.y, -8);
      ring.scale.setScalar(1 + beat * 0.08);
      ring.material.opacity = 0.2 + beat * 0.25;
    }
  }

  return { update, count: () => live.length };
}
