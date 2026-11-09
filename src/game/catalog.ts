/** Phase 2 swaps these placeholder names for the boys' real names. */
export interface CarConfig {
  id: string;
  /** Painted on the roof plate. Phase 2: replace with a real name. */
  name: string;
  /** Big numeral on the plate and the picker. */
  numeral: string;
  body: string;
  accent: string;
  roof: string;
  plate: string;
}

export const CARS: CarConfig[] = [
  { id: 'boy1', name: 'BOY 1', numeral: '1', body: '#ff3b30', accent: '#ffd60a', roof: '#fff7ea', plate: '#1c1c1e' },
  { id: 'boy2', name: 'BOY 2', numeral: '2', body: '#0a84ff', accent: '#64d2ff', roof: '#f4fbff', plate: '#102033' },
  { id: 'boy3', name: 'BOY 3', numeral: '3', body: '#30d158', accent: '#ffd60a', roof: '#f3fff6', plate: '#102816' },
  { id: 'boy4', name: 'BOY 4', numeral: '4', body: '#bf5af2', accent: '#ff9f0a', roof: '#fff5fb', plate: '#2a1433' },
];

export function carById(id: string): CarConfig {
  return CARS.find((car) => car.id === id) ?? CARS[0];
}

/**
 * Track pieces. Phase 1 builds the enabled launch ramp.
 * Loop, quarter-pipe, gap, and mega stay in the list so Phase 2 can turn them on
 * and add a builder in `terrain.ts` (`heightForRamp`).
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
