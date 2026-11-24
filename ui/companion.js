// The on-screen companion: 3D octo (emotes shown on it as expressions) + thinking-verb badge + stats popup,
// driven by state from the simulator and the Python bridge.
import '@fontsource/sora/latin-600.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './companion.css';
import { createScene3D } from './scene3d/Scene3D.js';
import {
  moodOf, verbPool, verbInterval, nextVerb, heatColor, ROSE, PINK, mix, rgba,
  POSE, FACE, EXPRESSIONS, EXPRESSION_S, nextEmote, emoteInterval, tempEmote, gpuHot,
} from './mood/mood.js';

// same defaults as the bridge (bridge/server.py); config.json overrides them through the bridge
const DEFAULT_LIMITS = { cpu_temp_alert: 90, gpu_temp_alert: 83, ram_percent_alert: 90, tokens_warning_percent: 80, tokens_critical_percent: 95 };
const resetTime = secs => (Number.isFinite(secs)
  ? new Date(secs * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  : '?'); // sprite px → CSS px (sprites are ~30 px wide)

export function createCompanion({ canvas, layer, model, onRegion, onBadgeClick, onControl, ...sceneOptions }) {
  layer.insertAdjacentHTML('beforeend', `
    <div class="badge" role="status" aria-live="off">
      <svg class="star" viewBox="-10 -10 20 20" aria-hidden="true"><path d="M0,-8V8M-7,-4L7,4M-7,4L7,-4"/></svg>
      <span class="who" hidden></span><span class="slot"></span><span class="pct">0%</span>
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
        <span class="pop-val pop-tokens-val">Session -- · Week --</span>
        <span class="pop-sub pop-tokens-sub">waiting for Claude Code</span>
      </div>
    </div>
    <div class="toast" role="status" aria-live="polite"></div>`);

  const badge = layer.querySelector('.badge');
  const slot = badge.querySelector('.slot');
  const pct = badge.querySelector('.pct');
  const who = badge.querySelector('.who'); // which Claude Code session this octo is
  const star = badge.querySelector('.star');
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
  const tokensSub = popup.querySelector('.pop-tokens-sub');

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
  function triggerToast(text, ms = 4000) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
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
  let poolExpr = null; // last expression from the mood's pool
  let poolUntil = 0;
  let emoteAt = 0;
  let faceTimer = 0;
  let faceKey = '';
  let lastRegion = '';
  let local = null;
  let started = false;
  let fidgetAt = 0;
  let loopAt = 0;
  let particleKey = '';

  function setVerb(word, suffix = '...') {
    // every word still on the badge leaves, not just the one already shown: a second change
    // within two frames used to leave both words stacked on top of each other (seen 2026-11-24)
    for (const old of slot.querySelectorAll('.w:not(.leave)')) {
      old.className = 'w leave';
      setTimeout(() => old.remove(), 500);
    }
    const span = document.createElement('span');
    span.className = 'w enter';
    span.textContent = `${word}${suffix}`;
    slot.append(span);
    slot.style.width = `${span.scrollWidth}px`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (span.className === 'w enter') span.className = 'w cur'; // unless it was already replaced
    }));
    verb = word;
    place();
  }

  function place() {
    if (!octo) return;
    const bw = badge.offsetWidth;
    const screenRight = (screen.availLeft ?? 0) + screen.availWidth - window.screenX;
    const limit = Math.min(layer.clientWidth, screenRight) - 8;
    let bx, by;
    if (!who.hidden) { // session octo: centred over its head, so side-by-side octos never collide
      bx = Math.max(8, Math.min(limit - bw, octo.x + (octo.width - bw) / 2));
      by = Math.max(22, octo.y - badge.offsetHeight + 4); // 22: room for the project tag above it
    } else {
      bx = octo.x + octo.width * 0.8;
      if (bx + bw > limit) bx = octo.x + octo.width * 0.2 - bw;
      bx = Math.max(8, bx);
      by = Math.max(8, octo.y + octo.height * 0.12);
    }
    moveTo(badge, bx, by);



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
    const tx = Math.max(8, Math.min(layer.clientWidth - tw - 8, octo.x + (octo.width - tw) / 2));
    let ty = octo.y - th - 12;
    const pa = popupOpen && anchors.get(popup);
    if (pa) { // never on top of the open popup: above it, else below the octo
      const above = pa.y - th - 6;
      ty = above >= 4 ? above : Math.min(layer.clientHeight - th - 4, octo.y + octo.height + 6);
    }
    moveTo(toast, tx, Math.max(4, ty));

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
    const limits = { ...DEFAULT_LIMITS, ...next.config?.thresholds };
    checkAlerts(next.telemetry, limits);
    checkTokens(next.usage, limits);
    if (popupOpen) renderPopup(next);
  }

  function renderPopup({ telemetry: t, controls: c, bridge, usage: u }) {
    const pctOf = w => (w ? `${Math.round(w.used_percentage)}%` : '--');
    setText(tokensVal, `Session ${pctOf(u?.five_hour)} · Week ${pctOf(u?.seven_day)}`);
    const stale = u && Date.now() / 1000 - u.received_at > 15 * 60; // status line only updates while Claude Code runs
    setText(tokensSub, !u ? 'waiting for Claude Code'
      : `resets ${resetTime(u.five_hour?.resets_at)}${stale ? ' · not updated recently' : ''}`);
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

  // Token alerts: one toast per window and level, re-armed when the window resets (spec: notify at 80 %).
  const tokenAlerted = new Set();
  function checkTokens(u, limits) {
    for (const [key, name] of [['five_hour', 'Session'], ['seven_day', 'Weekly']]) {
      const w = u?.[key];
      if (!w) continue;
      const level = w.used_percentage >= limits.tokens_critical_percent ? 'critical'
        : w.used_percentage >= limits.tokens_warning_percent ? 'warning' : null;
      const id = `${key}:${level}:${w.resets_at}`;
      if (!level || tokenAlerted.has(id)) continue;
      tokenAlerted.add(id);
      triggerToast(`${level === 'critical' ? '🛑' : '⚠'} ${name} tokens ${Math.round(w.used_percentage)}% used · resets ${resetTime(w.resets_at)}`, 6000);
    }
  }

  // Alert toasts, at most one per kind per minute
  function checkAlerts(t, limits) {
    if (!t) return;
    const nowMs = Date.now();
    const fire = (kind, text) => {
      if (nowMs - lastAlertTimes[kind] < 60000) return;
      lastAlertTimes[kind] = nowMs;
      triggerToast(text);
    };
    if (t.cpu?.temp >= limits.cpu_temp_alert) fire('cpu', `🔥 CPU hot: ${Math.round(t.cpu.temp)}°C`);
    else if (t.gpu?.awake && t.gpu?.temp >= limits.gpu_temp_alert) fire('gpu', `🔥 GPU hot: ${Math.round(t.gpu.temp)}°C`);
    else if (t.ram?.percent >= limits.ram_percent_alert) fire('ram', `⚠ RAM near full: ${Math.round(t.ram.percent)}%`);
  }

  function apply({ p, masti, temps, look, sleepy, emote: picked, label: session, doing }, now) {
    const name = session ?? '';
    if (who.textContent !== name) {
      who.textContent = name;
      who.hidden = !name;
      place();
    }
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
    // expression on the octo: picked (dock, Claude Code reaction) > local (hello, healing) >
    // temperature > the mood's pool (EXPRESSION_S every 8–15 s) > the mood's own face
    if (local && now >= local.until) local = null;
    let expr = picked ?? local?.emote ?? tempEmote(temps, m);
    if (!expr && now >= emoteAt) {
      poolExpr = nextEmote(m, poolExpr);
      poolUntil = now + EXPRESSION_S;
      emoteAt = now + emoteInterval();
    }
    if (!expr && now < poolUntil) expr = poolExpr;
    const x = EXPRESSIONS[expr];
    setParticles(m, p, temps, x?.particles);
    const base = x ?? { ...FACE[m], props: [] };
    const hot = gpuHot(temps) ? ['sweat'] : [];
    const face = { eyes: base.eyes, mouth: base.mouth, extras: [...new Set([...base.extras, ...hot])], props: base.props };
    const key = JSON.stringify(face);
    if (key !== faceKey) {
      faceKey = key;
      clearTimeout(faceTimer);
      faceTimer = setTimeout(() => scene.setFace(face), moodChanged ? faceDelay : 0);
    }
    // a session octo says what its session is doing (Saud's purpose for the bot);
    // the idle home octo, with no session, keeps the playful thinking verbs
    const vp = doing ? null : verbPool(p, masti);
    if (doing) {
      if (doing !== verb) {
        pool = null;
        setVerb(doing, '');
      }
    } else if (vp !== pool || now >= verbAt) {
      pool = vp;
      setVerb(nextVerb(vp, verb));
      verbAt = now + verbInterval(p);
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
    // { x, y } screen pixels (the session's terminal) or { fx, fy } screen fractions (the dock's test target)
    const dx = (look.x ?? look.fx * screen.width) - (window.screenX + octo.x + octo.width / 2);
    const dy = (look.y ?? look.fy * screen.height) - (window.screenY + octo.y + octo.height / 2);
    const nx = Math.max(-1, Math.min(1, dx / 500));
    const ny = Math.max(-1, Math.min(1, dy / 400));
    scene.setLook(0.44 * nx, 0.9 * nx, -0.6 * ny);
  }

  function setParticles(m, p, temps, extra) {
    const want = {
      zzz: m === 'idle', glyphs: m === 'light', sparks: m === 'deep',
      sweat: m === 'overdrive' || gpuHot(temps), steam: m === 'overdrive', aura: m === 'overdrive',
      hearts: m === 'masti', sparkles: m === 'masti', embers: p > 80 && m !== 'masti',
    };
    if (extra) { // an expression is showing: its particles replace the mood's (zZz next to an angry face read wrong)
      for (const kind of ['zzz', 'glyphs', 'sparks', 'steam', 'hearts', 'sparkles']) want[kind] = false;
      for (const kind of extra) want[kind] = true;
    }
    const key = JSON.stringify(want);
    if (key !== particleKey) {
      particleKey = key;
      scene.setParticles(want);
    }
  }

  return { update, scene, mood: () => mood, togglePopup, notify: triggerToast };
}
