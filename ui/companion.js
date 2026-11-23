// The on-screen companion: 3D octo + thinking-verb badge + emote sticker + stats popup (Phase 4),
// driven by state from the simulator and the Python bridge.
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

export function createCompanion({ canvas, layer, model, onRegion, onBadgeClick, onControl, ...sceneOptions }) {
  layer.insertAdjacentHTML('beforeend', `
    <img class="emote" alt="" style="opacity:0">
    <div class="badge" role="status" aria-live="off">
      <svg class="star" viewBox="-10 -10 20 20" aria-hidden="true"><path d="M0,-8V8M-7,-4L7,4M-7,4L7,-4"/></svg>
      <span class="slot"></span><span class="pct">0%</span>
    </div>
    <div class="popup" role="dialog" style="display:none">
      <div class="popup-head">
        <div class="popup-head-left">
          <span class="bridge-dot" title="Bridge Status"></span>
          <span>Pixel Companion</span>
        </div>
        <button class="popup-close" aria-label="Close">✕</button>
      </div>
      <div class="pop-row">
        <div class="pop-item"><span class="pop-lbl">CPU</span><span class="pop-val pop-cpu-val">0%</span><span class="pop-sub pop-cpu-temp">--°C</span></div>
        <div class="pop-item"><span class="pop-lbl">RAM</span><span class="pop-val pop-ram-val">0%</span><span class="pop-sub pop-ram-gb">--G</span></div>
      </div>
      <div class="pop-gpu-line">
        <span class="pop-lbl">GPU</span>
        <span class="pop-val pop-gpu-val">asleep (zZ)</span>
        <span class="pop-sub pop-gpu-extra"></span>
      </div>
      <div class="pop-row">
        <div class="pop-item"><span class="pop-lbl">BAT</span><span class="pop-val pop-bat-val">--%</span></div>
        <div class="pop-item"><span class="pop-lbl">FAN</span><span class="pop-val pop-fan-val">0 rpm</span></div>
      </div>
      <div class="pop-controls">
        <button class="ctrl-chip pop-btn-bt" title="Toggle Bluetooth">BT: --</button>
        <button class="ctrl-chip pop-btn-wifi" title="Toggle Wi-Fi">Wi-Fi: --</button>
        <div class="ctrl-slider-wrap">
          <span class="icon">☼</span>
          <input type="range" class="ctrl-slider pop-bright-slider" min="5" max="100" value="40" aria-label="Brightness">
          <span class="pop-sub pop-bright-val">40%</span>
        </div>
      </div>
      <div class="pop-tokens">
        <span class="pop-lbl">Tokens</span>
        <span class="pop-val pop-tokens-val">Session: -- | Week: --</span>
      </div>
    </div>
    <div class="toast" role="status" aria-live="polite"></div>`);

  const badge = layer.querySelector('.badge');
  const slot = badge.querySelector('.slot');
  const pct = badge.querySelector('.pct');
  const star = badge.querySelector('.star');
  const emote = layer.querySelector('.emote');
  const popup = layer.querySelector('.popup');
  const toast = layer.querySelector('.toast');

  // DOM elements in popup
  const bridgeDot = popup.querySelector('.bridge-dot');
  const popupClose = popup.querySelector('.popup-close');
  const cpuVal = popup.querySelector('.pop-cpu-val');
  const cpuTemp = popup.querySelector('.pop-cpu-temp');
  const ramVal = popup.querySelector('.pop-ram-val');
  const ramGb = popup.querySelector('.pop-ram-gb');
  const gpuVal = popup.querySelector('.pop-gpu-val');
  const gpuExtra = popup.querySelector('.pop-gpu-extra');
  const batVal = popup.querySelector('.pop-bat-val');
  const fanVal = popup.querySelector('.pop-fan-val');
  const btnBt = popup.querySelector('.pop-btn-bt');
  const btnWifi = popup.querySelector('.pop-btn-wifi');
  const brightSlider = popup.querySelector('.pop-bright-slider');
  const brightVal = popup.querySelector('.pop-bright-val');
  const tokensVal = popup.querySelector('.pop-tokens-val');

  let popupOpen = false;
  let currentBt = false;
  let currentWifi = false;
  let slidingBrightness = false;

  popupClose.addEventListener('click', e => {
    e.stopPropagation();
    togglePopup(false);
  });

  btnBt.addEventListener('click', e => {
    e.stopPropagation();
    onControl?.('bluetooth', !currentBt);
  });

  btnWifi.addEventListener('click', e => {
    e.stopPropagation();
    onControl?.('wifi', !currentWifi);
  });

  brightSlider.addEventListener('input', () => {
    slidingBrightness = true;
    brightVal.textContent = `${brightSlider.value}%`;
  });
  brightSlider.addEventListener('change', () => {
    slidingBrightness = false;
    onControl?.('brightness', +brightSlider.value);
  });

  function togglePopup(force) {
    popupOpen = typeof force === 'boolean' ? force : !popupOpen;
    popup.style.display = popupOpen ? 'block' : 'none';
    layer.classList.toggle('popup-open', popupOpen);
    if (popupOpen) renderPopup(state);
    place();
  }

  // Write text only when it changed: unconditional writes at 10 Hz cost CPU (measured in Phase 3a).
  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
  const onOff = (v, name) => (v === null || v === undefined ? `${name}: ?` : `${name}: ${v ? 'ON' : 'OFF'}`);

  // Alert toast system (cooldown: 60s per alert)
  const lastAlertTimes = { cpu: 0, gpu: 0, ram: 0, token: 0 };
  let toastTimer = null;
  function triggerToast(text) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
    place();
  }

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let starAngle = 0;
  let lastTick = null;
  const written = {};
  const set = (prop, value) => {
    if (written[prop] !== value) badge.style.setProperty(prop, (written[prop] = value));
  };

  if (onBadgeClick) {
    badge.style.pointerEvents = 'auto';
    badge.style.cursor = 'pointer';
    badge.title = 'Open the simulator dock';
    badge.addEventListener('click', onBadgeClick);
  }

  let octo = null;
  let state = { p: 0, masti: false };
  const scene = createScene3D(canvas, model, {
    ...sceneOptions,
    onRect: r => { octo = r; place(); },
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
  let local = null;
  let started = false;
  let fidgetAt = 0;
  let loopAt = 0;
  let particleKey = '';

  function setVerb(word) {
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

  function setEmote(name) {
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

  function place() {
    if (!octo) return;
    const bw = badge.offsetWidth;
    const screenRight = (screen.availLeft ?? 0) + screen.availWidth - window.screenX;
    const limit = Math.min(layer.clientWidth, screenRight) - 8;
    let bx = octo.x + octo.width * 0.8;
    const flipped = bx + bw > limit;
    if (flipped) bx = octo.x + octo.width * 0.2 - bw;
    bx = Math.max(8, bx);
    const by = Math.max(8, octo.y + octo.height * 0.12);
    moveTo(badge, bx, by);

    const ew = emote.offsetWidth || 64;
    const eh = emote.offsetHeight || 48;
    const ex = flipped ? octo.x + octo.width - ew * 0.6 : octo.x - ew * 0.4;
    const ey = Math.max(4, octo.y - eh * 0.55);
    moveTo(emote, Math.max(4, ex), ey);

    if (popupOpen) {
      const pw = popup.offsetWidth || 250;
      const ph = popup.offsetHeight || 190;
      let py = octo.y + octo.height + 8;
      if (py + ph > layer.clientHeight) py = Math.max(8, octo.y - ph - 8);
      let px = Math.max(8, Math.min(layer.clientWidth - pw - 8, octo.x + (octo.width - pw) / 2));
      moveTo(popup, px, py);
    }

    const tw = toast.offsetWidth || 180;
    const th = toast.offsetHeight || 30;
    let tx = Math.max(8, Math.min(layer.clientWidth - tw - 8, octo.x + (octo.width - tw) / 2));
    let ty = Math.max(8, octo.y - th - 12);
    moveTo(toast, tx, ty);

    emitRegion();
  }

  function emitRegion() {
    if (!octo || !onRegion) return;
    const extras = [];
    const a = anchors.get(badge);
    if (onBadgeClick && a && !popupOpen) extras.push(snapBox(a.x, a.y, badge.offsetWidth, badge.offsetHeight));
    if (popupOpen) {
      const pa = anchors.get(popup);
      if (pa) extras.push(snapBox(pa.x, pa.y, popup.offsetWidth, popup.offsetHeight));
    }
    const key = JSON.stringify([octo, extras]);
    if (key !== lastRegion) {
      lastRegion = key;
      onRegion({ octo, extras });
    }
  }

  const snapBox = (x, y, w, h) => {
    const x0 = Math.max(0, Math.floor(x / 8) * 8);
    const y0 = Math.max(0, Math.floor(y / 8) * 8);
    const x1 = Math.min(layer.clientWidth, Math.ceil((x + w) / 8) * 8);
    const y1 = Math.min(layer.clientHeight, Math.ceil((y + h) / 8) * 8);
    return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
  };

  const FOLLOW_PX = 12;
  const anchors = new Map();
  function moveTo(el, x, y) {
    const a = anchors.get(el);
    if (a && Math.abs(a.x - x) < FOLLOW_PX && Math.abs(a.y - y) < FOLLOW_PX) return;
    anchors.set(el, { x, y });
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function update(next) {
    state = next;
    checkAlerts(next.telemetry);
    if (popupOpen) renderPopup(next);
  }

  function renderPopup({ telemetry: t, controls: c, bridge }) {
    bridgeDot.classList.toggle('online', Boolean(bridge));
    if (t) {
      setText(cpuVal, `${Math.round(t.cpu?.usage ?? 0)}%`);
      setText(cpuTemp, t.cpu?.temp != null ? `${Math.round(t.cpu.temp)}°C` : '--°C');
      setText(ramVal, `${Math.round(t.ram?.percent ?? 0)}%`);
      setText(ramGb, `${t.ram?.used_gb ?? '--'}/${Math.round(t.ram?.total_gb ?? 0)}G`);
      if (!t.gpu?.awake) {
        setText(gpuVal, t.gpu?.available === false ? 'not found' : 'asleep (zZ)');
        setText(gpuExtra, '');
      } else {
        setText(gpuVal, `${t.gpu.usage}% ${t.gpu.temp ?? '--'}°C`);
        setText(gpuExtra, `${t.gpu.power_w}W`);
      }
      setText(batVal, `${Math.round(t.battery?.percent ?? 0)}%${t.battery?.plugged ? ' ⚡' : ''}`);
      setText(fanVal, `${t.fans?.cpu_rpm || t.fans?.gpu_rpm || 0} rpm`);
    }
    // controls: null = couldn't be read (shown as ?, button disabled), never a guessed value
    currentBt = c?.bluetooth;
    currentWifi = c?.wifi;
    setText(btnBt, onOff(currentBt, 'BT'));
    setText(btnWifi, onOff(currentWifi, 'Wi-Fi'));
    btnBt.disabled = typeof currentBt !== 'boolean';
    btnWifi.disabled = typeof currentWifi !== 'boolean';
    btnBt.classList.toggle('active', currentBt === true);
    btnWifi.classList.toggle('active', currentWifi === true);
    brightSlider.disabled = !c?.brightness;
    if (c?.brightness && !slidingBrightness) {
      brightSlider.value = c.brightness.percent;
      setText(brightVal, `${c.brightness.percent}%`);
    } else if (!c?.brightness) setText(brightVal, '?');
  }

  // Alert toasts, at most one per kind per minute (thresholds move to config in the token step)
  function checkAlerts(t) {
    if (!t) return;
    const nowMs = Date.now();
    const fire = (kind, text) => {
      if (nowMs - lastAlertTimes[kind] < 60000) return;
      lastAlertTimes[kind] = nowMs;
      triggerToast(text);
    };
    if (t.cpu?.temp >= 90) fire('cpu', `🔥 CPU hot: ${Math.round(t.cpu.temp)}°C`);
    else if (t.gpu?.awake && t.gpu?.temp >= 83) fire('gpu', `🔥 GPU hot: ${Math.round(t.gpu.temp)}°C`);
    else if (t.ram?.percent >= 90) fire('ram', `⚠ RAM near full: ${Math.round(t.ram.percent)}%`);
  }

  function apply({ p, masti, temps, look, sleepy, emote: picked }, now) {
    const m = moodOf(p, masti);
    const moodChanged = m !== mood;
    let faceDelay = 200;
    if (!started) {
      started = true;
      scene.play('wave');
      local = { emote: '01_hello', until: now + 4 };
      fidgetAt = now + 20 + 20 * Math.random();
    } else if (moodChanged && mood === 'overdrive' && m !== 'masti') {
      scene.play('tumble');
      local = { emote: '22_healing', until: now + 5 };
    } else if (moodChanged) {
      scene.play('peekTurn');
      faceDelay = 450;
    }
    if (moodChanged) {
      mood = m;
      scene.setPose(POSE[m]);
      emoteAt = 0;
      loopAt = now + 2;
    }
    behave(m, temps, sleepy, now);
    aim(look);
    setParticles(m, p, temps);
    const hot = gpuHot(temps) ? ['sweat'] : [];
    const key = m + hot.join();
    if (key !== faceKey) {
      faceKey = key;
      const face = { ...FACE[m], extras: [...new Set([...FACE[m].extras, ...hot])] };
      clearTimeout(faceTimer);
      faceTimer = setTimeout(() => scene.setFace(face), moodChanged ? faceDelay : 0);
    }
    const vp = verbPool(p, masti);
    if (vp !== pool || now >= verbAt) {
      pool = vp;
      setVerb(nextVerb(vp, verb));
      verbAt = now + verbInterval(p);
    }
    if (local && now >= local.until) local = null;
    const forced = picked ?? local?.emote ?? tempEmote(temps, m);
    if (forced) {
      if (forced !== emoteName) setEmote(forced);
      emoteAt = 0;
    } else if (now >= emoteAt) {
      setEmote(nextEmote(m, emoteName));
      emoteAt = now + emoteInterval();
    }
    const hc = m === 'masti' ? mix(ROSE, PINK, (Math.sin(now * 3) + 1) / 2) : heatColor(p);
    set('--hc', rgba(hc));
    set('--edge', rgba(hc, 0.75));
    set('--fill', rgba(mix([30, 18, 22], hc, 0.2), 0.78));
    set('--ink', rgba(mix(hc, [255, 255, 255], 0.38)));
    set('--glow', `0 0 ${Math.round(6 + p / 4)}px ${rgba(hc, 0.5)}, inset 0 0 14px ${rgba(hc, 0.18)}`);
    if (!reducedMotion && lastTick !== null) {
      starAngle = (starAngle + (60 + p * 5) * Math.min(0.5, now - lastTick)) % 360;
      star.style.transform = `rotate(${Math.round(starAngle)}deg)`;
    }
    lastTick = now;
    badge.classList.toggle('hot', p > 80 && m !== 'masti');
    const label = `${Math.round(p)}%`;
    if (pct.textContent !== label) pct.textContent = label;
  }

  function behave(m, temps, sleepy, now) {
    const loop = sleepy ? 'sleep' : gpuHot(temps) ? 'melt' : m === 'masti' ? 'dance' : null;
    if (loop && now >= loopAt) {
      scene.play(loop);
      loopAt = now + { sleep: 6.2, melt: 9, dance: 6 }[loop];
    }
    if (!loop && m === 'idle' && now >= fidgetAt) {
      scene.play(['peekTurn', 'roll', 'walk', 'peekTurn'][Math.floor(Math.random() * 4)]);
      fidgetAt = now + 20 + 20 * Math.random();
    }
  }

  function aim(look) {
    if (!look || !octo) return scene.setLook(0, 0, 0);
    const dx = look.fx * screen.width - (window.screenX + octo.x + octo.width / 2);
    const dy = look.fy * screen.height - (window.screenY + octo.y + octo.height / 2);
    const nx = Math.max(-1, Math.min(1, dx / 500));
    const ny = Math.max(-1, Math.min(1, dy / 400));
    scene.setLook(0.44 * nx, 0.9 * nx, -0.6 * ny);
  }

  function setParticles(m, p, temps) {
    const want = {
      zzz: m === 'idle', glyphs: m === 'light', sparks: m === 'deep',
      sweat: m === 'overdrive' || gpuHot(temps), steam: m === 'overdrive', aura: m === 'overdrive',
      hearts: m === 'masti', sparkles: m === 'masti', embers: p > 80 && m !== 'masti',
    };
    const key = JSON.stringify(want);
    if (key !== particleKey) {
      particleKey = key;
      scene.setParticles(want);
    }
  }

  return { update, scene, mood: () => mood, togglePopup, notify: triggerToast };
}
