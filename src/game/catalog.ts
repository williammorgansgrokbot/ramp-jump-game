/** One boy per color, in picker order: red, blue, green, yellow. */
export interface CarConfig {
  id: string;
  /** Painted on the plate and spoken at the start of a round. */
  name: string;
  /** Big numeral on the plate and the picker. */
  numeral: string;
  body: string;
  accent: string;
  roof: string;
  plate: string;
  /** Shiny wheel face. Matches the ComfyUI sprite for that boy. */
  rim: string;
  /** Colored ring in the cartoon eye. */
  iris: string;
}

export const CARS: CarConfig[] = [
  { id: 'boy1', name: 'Wyatt', numeral: '1', body: '#ff3b30', accent: '#ffd60a', roof: '#fff7ea', plate: '#1c1c1e', rim: '#ff2d2d', iris: '#3b82f6' },
  { id: 'boy2', name: 'Reed', numeral: '2', body: '#0a84ff', accent: '#64d2ff', roof: '#f4fbff', plate: '#102033', rim: '#f4f7fb', iris: '#7ec8ff' },
  { id: 'boy3', name: 'Brady', numeral: '3', body: '#30d158', accent: '#ffd60a', roof: '#f3fff6', plate: '#102816', rim: '#f4fbf6', iris: '#5ee07a' },
  { id: 'boy4', name: 'Stetson', numeral: '4', body: '#ffd60a', accent: '#ff9f0a', roof: '#fff8e6', plate: '#3a2a08', rim: '#fff4c2', iris: '#ff9f0a' },
];

export function carById(id: string): CarConfig {
  return CARS.find((car) => car.id === id) ?? CARS[0];
}

/**
 * Track pieces. Phase 1 builds the enabled launch ramp.
 * Each kind is a real course on its own lane. The original launch stays the
 * first one so that jump does not get retuned.
 */
export type RampKind = 'launch' | 'loop' | 'quarter-pipe' | 'gap' | 'mega';

export interface RampRecipe {
  id: string;
  kind: RampKind;
  /** World Z where the piece starts. */
  z: number;
  length: number;
  /** Crest height in meters. The launch profile adds a small kicker on top. */
  height: number;
  enabled: boolean;
}

export const RAMPS: RampRecipe[] = [
  { id: 'giant-launch', kind: 'launch', z: 50, length: 24, height: 7.4, enabled: true },
  { id: 'loop', kind: 'loop', z: 0, length: 18, height: 8, enabled: false },
  { id: 'quarter-pipe', kind: 'quarter-pipe', z: 0, length: 14, height: 7, enabled: false },
  { id: 'gap-jump', kind: 'gap', z: 0, length: 16, height: 5, enabled: false },
  { id: 'mega-ramp', kind: 'mega', z: 0, length: 32, height: 14, enabled: false },
];

export function enabledLaunch(): RampRecipe {
  const ramp = RAMPS.find((item) => item.enabled && (item.kind === 'launch' || item.kind === 'mega'));
  if (!ramp) throw new Error('Phase 1 needs an enabled launch or mega ramp');
  return ramp;
}
