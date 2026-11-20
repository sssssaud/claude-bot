// The on-screen companion: 3D octo + thinking-verb badge + emote sticker, driven by a state
// ({ p, masti, temps, emote }) from the simulator now and from the bridge in Phase 4.
import '@fontsource/sora/latin-600.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './companion.css';
import { createScene3D } from './scene3d/Scene3D.js';
import {
  moodOf, verbPool, verbInterval, nextVerb, heatColor, ROSE, PINK, mix, rgba,
  POSE, FACE, nextEmote, emoteInterval, tempEmote, gpuHot,
} from './mood/mood.js';

const SPRITES = import.meta.glob('../assets/emotes-clean/[0-9][0-9]_*.png', { eager: true, query: '?url', import: 'default' });
const spriteUrl = name => SPRITES[`../assets/emotes-clean/${name}.png`];
const EMOTE_SCALE = 2; // sprite px → CSS px (sprites are ~30 px wide)

export function createCompanion({ canvas, layer, model, onRegion, onBadgeClick, ...sceneOptions }) {
  layer.insertAdjacentHTML('beforeend', `
    <img class="emote" alt="" style="opacity:0">
    <div class="badge" role="status" aria-live="off">
      <svg class="star" viewBox="-10 -10 20 20" aria-hidden="true"><path d="M0,-8V8M-7,-4L7,4M-7,4L7,-4"/></svg>
      <span class="slot"></span><span class="pct">0%</span>
    </div>`);
  const badge = layer.querySelector('.badge');
  const slot = badge.querySelector('.slot');
  const pct = badge.querySelector('.pct');
  const star = badge.querySelector('.star');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let starAngle = 0;
  let lastTick = null;
  const written = {};
  const set = (prop, value) => {
    if (written[prop] !== value) badge.style.setProperty(prop, (written[prop] = value));
  };
  const emote = layer.querySelector('.emote');
  if (onBadgeClick) { // the badge doubles as the handle that opens the simulator dock (spec §8)
    badge.style.pointerEvents = 'auto';
    badge.style.cursor = 'pointer';
    badge.title = 'Open the simulator dock';
    badge.addEventListener('click', onBadgeClick);
  }

  let octo = null; // octo box in CSS px, from Scene3D
  let state = { p: 0, masti: false };
  const scene = createScene3D(canvas, model, {
    ...sceneOptions,
    onRect: r => { octo = r; place(); },
    // Badge work rides on the octo's own frames: a separate timer made extra compositor frames
    // between the 3D ones (measured, Phase 3a).
    onFrame: () => apply(state, performance.now() / 1000),
  });

  let mood = null;
  let pool = null;
  let verb = null;
  let verbAt = 0;
  let emoteName = null;
  let emoteAt = 0;
  let faceTimer = 0;
  let faceKey = '';
  let lastRegion = '';

  function setVerb(word) { // vertical slot slide + blur fade (preview)
    const old = slot.querySelector('.cur');
    const span = document.createElement('span');
    span.className = 'w enter';
    span.textContent = `${word}...`;
    slot.append(span);
    slot.style.width = `${span.scrollWidth}px`;
    requestAnimationFrame(() => requestAnimationFrame(() => (span.className = 'w cur')));
    if (old) {
      old.className = 'w leave';
      setTimeout(() => old.remove(), 500);
    }
    verb = word;
    place();
  }

  function setEmote(name) { // fade out, swap, fade in
    emoteName = name;
    emote.style.opacity = '0';
    setTimeout(() => {
      emote.onload = () => {
        emote.style.width = `${emote.naturalWidth * EMOTE_SCALE}px`;
        place();
        emote.style.opacity = '1';
      };
      emote.src = spriteUrl(name);
      emote.alt = name.slice(3).replace(/_/g, ' ');
    }, 250);
  }

  // Badge beside the octo; it flips to the other side when it would leave the window or the screen.
  function place() {
    if (!octo) return;
    const bw = badge.offsetWidth;
    const screenRight = (screen.availLeft ?? 0) + screen.availWidth - window.screenX; // in window px
    const limit = Math.min(layer.clientWidth, screenRight) - 8;
    let bx = octo.x + octo.width * 0.8;
    const flipped = bx + bw > limit;
    if (flipped) bx = octo.x + octo.width * 0.2 - bw;
    bx = Math.max(8, bx);
    const by = Math.max(8, octo.y + octo.height * 0.12);
    moveTo(badge, bx, by);
    // sticker sits above the octo's head on the side away from the badge
    const ew = emote.offsetWidth || 64;
    const eh = emote.offsetHeight || 48;
    const ex = flipped ? octo.x + octo.width - ew * 0.6 : octo.x - ew * 0.4;
    const ey = Math.max(4, octo.y - eh * 0.55);
    moveTo(emote, Math.max(4, ex), ey);
    emitRegion();
  }

  // Clickable boxes for the window's input region: the octo, plus the badge if it's a handle.
  function emitRegion() {
    if (!octo || !onRegion) return;
    const extras = [];
    const a = anchors.get(badge);
    if (onBadgeClick && a) extras.push(snapBox(a.x, a.y, badge.offsetWidth, badge.offsetHeight));
    const key = JSON.stringify([octo, extras]);
    if (key !== lastRegion) {
      lastRegion = key;
      onRegion({ octo, extras });
    }
  }
  const snapBox = (x, y, w, h) => { // grow outward to 8 px, keep inside the window
    const x0 = Math.max(0, Math.floor(x / 8) * 8);
    const y0 = Math.max(0, Math.floor(y / 8) * 8);
    const x1 = Math.min(layer.clientWidth, Math.ceil((x + w) / 8) * 8);
    const y1 = Math.min(layer.clientHeight, Math.ceil((y + h) / 8) * 8);
    return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
  };

  // Follow real moves (jump, roll, drag), not the idle bob: every re-anchor starts a 0.5 s spring
  // transition, i.e. 60 FPS compositing, and the bob crossed the box's 8 px snap every ~1.4 s
  // (measured: the badge cost ~13 % of a core at idle).
  const FOLLOW_PX = 12;
  const anchors = new Map();
  function moveTo(el, x, y) {
    const a = anchors.get(el);
    if (a && Math.abs(a.x - x) < FOLLOW_PX && Math.abs(a.y - y) < FOLLOW_PX) return;
    anchors.set(el, { x, y });
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  // Latest state ({ p, masti, temps, emote }); applied on the next drawn frame.
  function update(next) {
    state = next;
  }

  function apply({ p, masti, temps, emote: picked }, now) {
    const m = moodOf(p, masti);
    const moodChanged = m !== mood;
    if (moodChanged) {
      mood = m;
      scene.setPose(POSE[m]);
      emoteAt = 0;
    }
    const hot = gpuHot(temps) ? ['sweat'] : []; // GPU over 83 °C: sweat (melt arrives in 3c)
    const key = m + hot.join();
    if (key !== faceKey) {
      faceKey = key;
      const face = { ...FACE[m], extras: [...new Set([...FACE[m].extras, ...hot])] };
      clearTimeout(faceTimer);
      faceTimer = setTimeout(() => scene.setFace(face), moodChanged ? 200 : 0); // eyes swap mid-crossfade
    }
    const vp = verbPool(p, masti);
    if (vp !== pool || now >= verbAt) {
      pool = vp;
      setVerb(nextVerb(vp, verb));
      verbAt = now + verbInterval(p);
    }
    // sticker: an emote picked in the dock, else a temperature emote, else the mood's pool
    const forced = picked ?? tempEmote(temps, m);
    if (forced) {
      if (forced !== emoteName) setEmote(forced);
      emoteAt = 0; // back to the pool as soon as it ends
    } else if (now >= emoteAt) {
      setEmote(nextEmote(m, emoteName));
      emoteAt = now + emoteInterval();
    }
    const hc = m === 'masti' ? mix(ROSE, PINK, (Math.sin(now * 3) + 1) / 2) : heatColor(p);
    // write only what changed: every style write repaints the glowing badge (measured: +15 % CPU at idle)
    set('--hc', rgba(hc));
    set('--edge', rgba(hc, 0.75));
    set('--fill', rgba(mix([30, 18, 22], hc, 0.2), 0.78));
    set('--ink', rgba(mix(hc, [255, 255, 255], 0.38)));
    set('--glow', `0 0 ${Math.round(6 + p / 4)}px ${rgba(hc, 0.5)}, inset 0 0 14px ${rgba(hc, 0.18)}`);
    if (!reducedMotion && lastTick !== null) { // stepped spinner: 60 + 5·p degrees per second
      starAngle = (starAngle + (60 + p * 5) * Math.min(0.5, now - lastTick)) % 360;
      star.style.transform = `rotate(${Math.round(starAngle)}deg)`;
    }
    lastTick = now;
    badge.classList.toggle('hot', p > 80 && m !== 'masti');
    const label = `${Math.round(p)}%`;
    if (pct.textContent !== label) pct.textContent = label;
  }

  return { update, scene, mood: () => mood };
}
