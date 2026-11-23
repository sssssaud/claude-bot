// The 3D octo: voxel model + toon shading + sticker outline + motion, drawn into one canvas.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { parseModel, bounds, exposedFaces } from './voxels.js';
import { createPlayer, squashScale, frameGate } from './moves.js';
import { createParticles } from './particles.js';

const TAU = Math.PI * 2;
const TILT = THREE.MathUtils.degToRad(12); // slight top-down view: front reads like the sprite
const VIEW_H = 34; // voxels visible vertically: room for a jump, and a roll stays in view
const OUTLINE = 0.7; // white sticker border thickness, in voxels
const IDLE_FPS = 24;

// Sticker border as a screen-space pass: an empty pixel near the octo's silhouette turns white.
// ponytail: not the spec's inverted hull. A per-voxel hull pokes out of the front face and draws
// white lines on every row seam (seen in Phase 1); this pass is one shader and stays outside-only.
const OUTLINE_SHADER = {
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tex; uniform vec2 texel; uniform float radius; uniform bool on;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tex, vUv);
      float near = 0.0;
      if (on && c.a < 0.5) {
        for (int i = 0; i < 16; i++) {
          vec2 d = vec2(cos(float(i) * 0.3926991), sin(float(i) * 0.3926991)) * texel * radius;
          near = max(near, max(texture2D(tex, vUv + d).a, texture2D(tex, vUv + d * 0.5).a));
        }
      }
      gl_FragColor = near > 0.5 ? vec4(1.0) : c;
      #include <colorspace_fragment>
    }`,
};

export function createScene3D(canvas, model, { outline = true, speed = 1, orbit = true, onRect = null, onFrame = null } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.info.autoReset = false; // two passes per frame: count draw calls per frame, not per pass
  const scene = new THREE.Scene();

  scene.add(new THREE.HemisphereLight(0xfff1e8, 0x6b3a2e, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-4, 8, 10);
  scene.add(key);

  const ramp = new THREE.DataTexture(new Uint8Array([120, 195, 255]), 3, 1, THREE.RedFormat); // 3-step toon
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  const mats = new Map();
  const material = hex => {
    if (!mats.has(hex)) mats.set(hex, new THREE.MeshToonMaterial({ color: hex, gradientMap: ramp }));
    return mats.get(hex);
  };
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const post = new THREE.ShaderMaterial({
    ...OUTLINE_SHADER,
    uniforms: { tex: { value: rt.texture }, texel: { value: new THREE.Vector2() }, radius: { value: 1 }, on: { value: outline } },
    depthTest: false,
    depthWrite: false,
  });
  const postScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post);
  quad.frustumCulled = false;
  postScene.add(quad);
  const postCam = new THREE.Camera();

  const parts = parseModel(model);
  const all = Object.values(parts).flatMap(p => p.voxels);
  const body = bounds(parts.body.voxels);
  const ground = bounds(all).minY - 0.5;

  // rig: root (travel, jump) > squash (pivot at the feet) > spin (pivot at body centre) > model
  const root = new THREE.Group();
  const squash = new THREE.Group();
  const spin = new THREE.Group();
  const modelGroup = new THREE.Group();
  scene.add(root);
  root.add(squash);
  squash.add(spin);
  spin.add(modelGroup);
  spin.position.y = body.cy - ground;
  modelGroup.position.set(-body.cx, -body.cy, -body.cz);

  // ponytail: one merged mesh of exposed faces per part and colour (not the spec's InstancedMesh
  // per material): parts move on their own, and full cubes z-fight on their buried faces.
  // 13 draw calls for the whole octo.
  const groups = {};
  for (const [name, part] of Object.entries(parts)) {
    const pb = bounds(part.voxels);
    const g = new THREE.Group();
    g.position.set(pb.cx, pb.maxY + 0.5, pb.cz); // top centre: legs swing from the body
    g.visible = !part.hidden;
    const faces = exposedFaces(part.voxels);
    for (const color of new Set(part.voxels.map(v => v.color))) {
      const geo = faceGeometry(faces.filter(({ v }) => v.color === color), g.position, part.thick);
      g.add(new THREE.Mesh(geo, material(color)));
    }
    modelGroup.add(g);
    groups[name] = g;
  }
  const legs = Object.keys(groups).filter(n => n.startsWith('leg')).map(n => groups[n]);

  // Face: one eyes part, one mouth (or none), any extras. A blink closes whatever eyes are shown.
  const faceParts = Object.keys(groups).filter(n => /^(eyes|mouth|extra|prop)\./.test(n)).map(n => [n, ...n.split('.')]);
  let face = { eyes: 'open', mouth: 'none', extras: [], props: [] };
  const eyeGroups = faceParts.filter(([, kind]) => kind === 'eyes').map(([n]) => [groups[n], groups[n].position.clone()]);
  function showFace(p) { // a move can override the eyes (dizzy, sleepy); a blink closes open eyes
    const eyes = p.eyes ?? (p.blink && !['sleepy', 'closed', 'dead', 'dizzy'].includes(face.eyes) ? 'closed' : face.eyes);
    for (const [n, kind, name] of faceParts) {
      groups[n].visible = kind === 'eyes' ? name === eyes : kind === 'mouth' ? name === face.mouth
        : kind === 'prop' ? face.props.includes(name) : face.extras.includes(name);
    }
  }

  const shadow = blobShadow(body.maxX - body.minX + 4, body.maxZ - body.minZ + 6);
  scene.add(shadow);
  const flatScene = new THREE.Scene(); // drawn after the outline pass: no sticker border
  const particles = createParticles(scene, flatScene);
  let wantParticles = {};
  let lastFrame = null;

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
  const target = new THREE.Vector3(0, spin.position.y + 3, 0);
  cam.position.set(0, target.y + 80 * Math.sin(TILT), 80 * Math.cos(TILT));
  cam.lookAt(target);
  let dragging = false;
  if (orbit) { // test page only: on the desktop, dragging moves the window instead
    const controls = new OrbitControls(cam, canvas);
    controls.target.copy(target);
    controls.update();
    controls.addEventListener('start', () => (dragging = true));
    controls.addEventListener('end', () => (dragging = false));
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    rt.setSize(w * dpr, h * dpr);
    post.uniforms.texel.value.set(1 / (w * dpr), 1 / (h * dpr));
    post.uniforms.radius.value = OUTLINE * (h * dpr) / VIEW_H; // voxels -> device pixels
    const a = w / h;
    Object.assign(cam, { left: -VIEW_H * a / 2, right: VIEW_H * a / 2, top: VIEW_H / 2, bottom: -VIEW_H / 2 });
    cam.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  const player = createPlayer();
  const clock = () => (performance.now() / 1000) * speed; // speed < 1 = slow motion
  let raf = 0;
  let nextDraw = 0;
  let frames = 0;
  let fpsFrom = clock();
  let fps = 0;

  function frame() {
    raf = requestAnimationFrame(frame);
    const now = clock();
    const gate = frameGate(!player.busy() && !dragging, now, nextDraw, IDLE_FPS);
    if (gate === null) return;
    nextDraw = gate;

    const p = player.pose(now);
    root.position.set(p.x, p.y, 0);
    squash.scale.set(...squashScale(p.squash));
    spin.rotation.set(p.rotX, p.rotY, p.rotZ);
    showFace(p);
    for (const [g, base] of eyeGroups) g.position.set(base.x + p.eyeX, base.y + p.eyeY, base.z); // gaze
    if (groups.armR) groups.armR.rotation.z = p.armR; // wave
    legs.forEach((g, i) => {
      g.rotation.z = 0.12 * p.legAmp * Math.sin(TAU * 1.2 * now + i * 0.8); // sway / flail
      g.rotation.x = 0.55 * p.legGait * Math.sin(TAU * 4 * now + i * Math.PI / 2); // walking wave gait
    });
    const dt = lastFrame === null ? 0 : Math.min(0.1, now - lastFrame);
    lastFrame = now;
    particles.update(dt, now, { x: p.x, y: p.y + spin.position.y }, { ...wantParticles, zzz: wantParticles.zzz || p.zzz });
    const s = 1 / (1 + Math.max(0, p.y) * 0.1);
    shadow.position.x = p.x;
    shadow.scale.set(s, s, 1);
    shadow.material.opacity = s;

    renderer.info.reset();
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
    renderer.autoClear = false;
    renderer.render(flatScene, cam);
    renderer.autoClear = true;
    if (onRect) reportRect();
    onFrame?.();
    frames++;
    if (now - fpsFrom >= 1) {
      fps = frames / (now - fpsFrom);
      frames = 0;
      fpsFrom = now;
    }
  }
  // The octo's on-screen box in CSS px (body, legs, outline, shadow), for the window's click
  // region. Padded by the outline plus a few px so one frame of lag never clips a fast jump.
  const box = new THREE.Box3();
  const shadowBox = new THREE.Box3();
  const corner = new THREE.Vector3();
  let lastRect = '';
  function reportRect() {
    box.setFromObject(root).union(shadowBox.setFromObject(shadow));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(cam);
      x0 = Math.min(x0, corner.x); x1 = Math.max(x1, corner.x);
      y0 = Math.min(y0, corner.y); y1 = Math.max(y1, corner.y);
    }
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const pad = (OUTLINE * h) / VIEW_H + 6;
    const snap = 8; // grow outward to an 8 px grid, so the idle bob doesn't resend the box all the time
    const left = Math.max(0, Math.floor((((x0 + 1) / 2) * w - pad) / snap) * snap);
    const top = Math.max(0, Math.floor((((1 - y1) / 2) * h - pad) / snap) * snap);
    const right = Math.min(w, Math.ceil((((x1 + 1) / 2) * w + pad) / snap) * snap);
    const bottom = Math.min(h, Math.ceil((((1 - y0) / 2) * h + pad) / snap) * snap);
    const rect = { x: left, y: top, width: right - left, height: bottom - top };
    const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
    if (key !== lastRect && rect.width > 0 && rect.height > 0) {
      lastRect = key;
      onRect(rect);
    }
  }

  const start = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); };
  document.addEventListener('visibilitychange', () => (document.hidden ? cancelAnimationFrame(raf) : start()));
  start();

  return {
    play: name => player.play(name, clock()),
    setLook: (yaw, ex, ey) => player.setLook(yaw, ex, ey),
    setDragging: on => player.setDragging(on, clock()),
    setParticles: want => { wantParticles = want; },
    setPose: pose => player.setMood(pose, clock()),
    setFace: f => {
      const has = (kind, name) => groups[`${kind}.${name}`];
      face = {
        eyes: has('eyes', f.eyes) ? f.eyes : 'open',
        mouth: has('mouth', f.mouth) ? f.mouth : 'none',
        extras: (f.extras ?? []).filter(x => has('extra', x)),
        props: (f.props ?? []).filter(x => has('prop', x)),
      };
    },
    setOutline: on => (post.uniforms.on.value = on),
    stats: () => ({ fps: Math.round(fps), voxels: all.length, draws: renderer.info.render.calls }),
  };
}

// Copy each exposed face's 4 corners out of a unit BoxGeometry (same face order as exposedFaces).
function faceGeometry(faces, origin, thick) {
  const box = new THREE.BoxGeometry(1, 1, thick);
  const P = box.attributes.position.array;
  const N = box.attributes.normal.array;
  const I = box.index.array;
  const pos = [];
  const nor = [];
  const idx = [];
  for (const { v, f } of faces) {
    const base = pos.length / 3;
    for (let k = 0; k < 4; k++) {
      const i = (4 * f + k) * 3;
      pos.push(P[i] + v.x - origin.x, P[i + 1] + v.y - origin.y, P[i + 2] + v.z - origin.z);
      nor.push(N[i], N[i + 1], N[i + 2]);
    }
    for (let k = 0; k < 6; k++) idx.push(I[6 * f + k] - 4 * f + base);
  }
  box.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  return geo;
}

function blobShadow(w, d) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(40, 18, 14, 0.45)');
  g.addColorStop(1, 'rgba(40, 18, 14, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.01;
  return mesh;
}
