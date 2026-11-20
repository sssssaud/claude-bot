// Where the overlay window goes. Pure maths (node-testable). Rects are { x, y, width, height }
// in screen DIP; displays are [{ id, workArea }]. Positions are the window's top-left { x, y };
// `octo` is the octo's box inside the window (the window itself is mostly empty, click-through
// space, so it may hang off-screen; only the octo must stay inside the work area).

const overlap = (a, b) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

const centreDistance = (a, b) =>
  Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2));

// The display showing most of `rect`; if it is on none of them, the closest one.
export function nearestDisplay(rect, displays) {
  return displays.reduce((best, d) => {
    const o = overlap(rect, d.workArea) - overlap(rect, best.workArea);
    return o > 0 || (o === 0 && centreDistance(rect, d.workArea) < centreDistance(rect, best.workArea)) ? d : best;
  });
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
const octoAt = (pos, octo) => ({ x: pos.x + octo.x, y: pos.y + octo.y, width: octo.width, height: octo.height });

// Move the window as little as possible so the octo is fully inside `area`.
export function clampOcto(pos, octo, area) {
  return {
    x: Math.round(clamp(pos.x + octo.x, area.x, area.x + area.width - octo.width) - octo.x),
    y: Math.round(clamp(pos.y + octo.y, area.y, area.y + area.height - octo.height) - octo.y),
  };
}

// Remember the spot as fractions of the work area, so it survives resolution changes.
export function toSaved(pos, octo, display) {
  const a = display.workArea;
  const o = octoAt(pos, octo);
  return {
    displayId: display.id,
    fx: clamp((o.x - a.x) / Math.max(1, a.width - o.width), 0, 1),
    fy: clamp((o.y - a.y) / Math.max(1, a.height - o.height), 0, 1),
  };
}

// Back to a window position: the saved display if it still exists, otherwise the primary one.
export function fromSaved(saved, octo, displays, primaryId) {
  const d = displays.find(x => x.id === saved?.displayId) ?? displays.find(x => x.id === primaryId) ?? displays[0];
  const a = d.workArea;
  const fx = Number.isFinite(saved?.fx) ? clamp(saved.fx, 0, 1) : 0.97; // default: bottom right
  const fy = Number.isFinite(saved?.fy) ? clamp(saved.fy, 0, 1) : 1;
  return clampOcto({
    x: Math.round(a.x + fx * (a.width - octo.width) - octo.x),
    y: Math.round(a.y + fy * (a.height - octo.height) - octo.y),
  }, octo, a);
}
