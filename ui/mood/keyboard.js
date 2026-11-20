// Mock 4-zone keyboard effects for the dock strip; the bridge drives the real keyboard in
// Phase 4. Port of the approved preview's effect(): a target colour per zone at time t.
import { hex, mix, ROSE, PINK } from './mood.js';

const TERRA = hex('#E07A5F');
const AMBER = hex('#FFB347');
const CORAL = hex('#FF7F50');
const ORANGE = hex('#FF5500');
const CRIMSON = hex('#FF1E00');
const BLACK = [0, 0, 0];

export const EFFECTS = { idle: 'Breathing 0.2 Hz', light: 'Steady coral', deep: 'Orange pulse', overdrive: 'Heartbeat 1.5 Hz', masti: 'Rose shimmer' };

export function zoneColor(mood, t, zone, random = Math.random) {
  if (mood === 'idle') {
    const s = (Math.sin(t * Math.PI * 2 * 0.2) + 1) / 2;
    return mix(mix(TERRA, AMBER, s * 0.5), BLACK, 0.65 - 0.65 * s);
  }
  if (mood === 'light') return mix(CORAL, BLACK, 0.08);
  if (mood === 'deep') return mix(ORANGE, BLACK, 0.4 - 0.4 * Math.abs(Math.sin(t * Math.PI * 1.2 + zone * 0.35)));
  if (mood === 'overdrive') { // lub-dub at 1.5 Hz with a slight flicker
    const ph = (t * 1.5) % 1;
    const g = x => Math.exp(-(((ph - x) / 0.06) ** 2));
    const beat = Math.min(1, g(0) + g(1) + 0.7 * g(0.22));
    return mix(CRIMSON, BLACK, 1 - (0.35 + 0.65 * beat) * (0.9 + 0.1 * random()));
  }
  return mix(mix(ROSE, PINK, (Math.sin(t * Math.PI + zone * 0.8) + 1) / 2), BLACK, 0.05); // masti
}

// One "write": each zone eases 35 % toward its target (the preview's lerp; the bridge uses HSV).
export const stepZones = (zones, mood, t, random) => zones.map((c, z) => mix(c, zoneColor(mood, t, z, random), 0.35));
