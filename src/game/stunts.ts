/** Side-by-side stunt lanes. The original launch stays on x = 0. */

export type StuntId = 'launch' | 'loop' | 'quarter' | 'gap' | 'mega';

export interface Stunt {
  id: StuntId;
  laneX: number;
  spawn: { x: number; y: number; z: number };
}

export const LOOP = { laneX: 38, radius: 6, zCenter: 34, halfW: 3.1 };
export const QUARTER = { laneX: 76, radius: 7.2, z0: 28, halfW: 3.2 };
export const GAP = { laneX: 114, rampZ0: 18, rampZ1: 36, height: 5.6, landZ0: 54, landZ1: 140 };
export const MEGA = { laneX: 156, top: 15, plateauZ1: 16, dropZ1: 46, landZ0: 46, landZ1: 150, landTop: 0.35 };

export const STUNTS: Stunt[] = [
  { id: 'launch', laneX: 0, spawn: { x: 0, y: 1.28, z: 4 } },
  { id: 'loop', laneX: LOOP.laneX, spawn: { x: LOOP.laneX, y: 1.28, z: 4 } },
  { id: 'quarter', laneX: QUARTER.laneX, spawn: { x: QUARTER.laneX, y: 1.28, z: 4 } },
  { id: 'gap', laneX: GAP.laneX, spawn: { x: GAP.laneX, y: 1.28, z: 4 } },
  { id: 'mega', laneX: MEGA.laneX, spawn: { x: MEGA.laneX, y: MEGA.top + 1.28, z: 5 } },
];

export function stuntById(id: string): Stunt {
  return STUNTS.find((item) => item.id === id) ?? STUNTS[0];
}

/** Nearest lane center, used so steering help stays on the road the car is on. */
export function laneCenter(x: number): number {
  let best = STUNTS[0].laneX;
  let dist = Infinity;
  for (const stunt of STUNTS) {
    const d = Math.abs(x - stunt.laneX);
    if (d < dist) {
      dist = d;
      best = stunt.laneX;
    }
  }
  return best;
}

export interface BoostPad {
  x: number;
  z: number;
  length: number;
  kick: number;
}

export const BOOSTS: BoostPad[] = [
  { x: LOOP.laneX, z: 20, length: 3.2, kick: 9 },
  { x: QUARTER.laneX, z: 16, length: 3.2, kick: 8 },
  { x: GAP.laneX, z: 10, length: 3.2, kick: 10 },
  { x: MEGA.laneX, z: 10, length: 3.2, kick: 7 },
];

export interface Ribbon {
  vertices: Float32Array;
  indices: Uint32Array;
}

function ribbon(samples: { x: number; y: number; z: number; half: number }[]): Ribbon {
  const cols = 6;
  const positions: number[] = [];
  const indices: number[] = [];
  samples.forEach((sample) => {
    for (let k = 0; k <= cols; k++) {
      const u = -sample.half + (k / cols) * sample.half * 2;
      positions.push(sample.x + u, sample.y, sample.z);
    }
  });
  const row = cols + 1;
  for (let i = 0; i < samples.length - 1; i++) {
    for (let k = 0; k < cols; k++) {
      const a = i * row + k;
      indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  return { vertices: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

/**
 * Loop from the bottom, up the front, over the top, and down the back
 * until it is still well above the entrance road. The lower rear is open
 * so the car can drive in without hitting the return.
 */
export function loopRibbon(): Ribbon {
  const { radius: r, zCenter, laneX, halfW } = LOOP;
  const seg = 48;
  const thetaMax = Math.PI + 0.95;
  const samples = [];
  for (let i = 0; i <= seg; i++) {
    const theta = (i / seg) * thetaMax;
    samples.push({
      x: laneX,
      y: r * (1 - Math.cos(theta)),
      z: zCenter + r * Math.sin(theta),
      half: halfW,
    });
  }
  return ribbon(samples);
}

/** Quarter circle from flat to just short of vertical. */
export function quarterRibbon(): Ribbon {
  const { radius: r, z0, laneX, halfW } = QUARTER;
  const seg = 28;
  const samples = [];
  const max = Math.PI * 0.46;
  for (let i = 0; i <= seg; i++) {
    const theta = (i / seg) * max;
    samples.push({
      x: laneX,
      y: r * (1 - Math.cos(theta)),
      z: z0 + r * Math.sin(theta),
      half: halfW,
    });
  }
  return ribbon(samples);
}

export function loopPose(theta: number, ride: number): { x: number; y: number; z: number; up: { y: number; z: number }; fwd: { y: number; z: number } } {
  const { radius: r, zCenter, laneX } = LOOP;
  const up = { y: Math.cos(theta), z: -Math.sin(theta) };
  const fwd = { y: Math.sin(theta), z: Math.cos(theta) };
  return {
    x: laneX,
    y: r * (1 - Math.cos(theta)) + up.y * ride,
    z: zCenter + r * Math.sin(theta) + up.z * ride,
    up,
    fwd,
  };
}

export function gapRampHeight(z: number): number {
  if (z <= GAP.rampZ0) return 0;
  if (z >= GAP.rampZ1) return GAP.height + 0.7;
  const t = (z - GAP.rampZ0) / (GAP.rampZ1 - GAP.rampZ0);
  const s = t * t * (3 - 2 * t);
  let h = s * GAP.height;
  if (t > 0.72) h += ((t - 0.72) / 0.28) ** 2 * 0.7;
  return h;
}

export function gapLandHeight(z: number): number {
  if (z <= GAP.landZ0) return 1.4;
  if (z >= GAP.landZ1) return 0.25;
  const t = (z - GAP.landZ0) / (GAP.landZ1 - GAP.landZ0);
  const s = t * t * (3 - 2 * t);
  return 1.4 + (0.25 - 1.4) * s;
}

export function megaRunHeight(z: number): number {
  if (z <= MEGA.plateauZ1) return MEGA.top;
  if (z >= MEGA.dropZ1) return 0.35;
  const t = (z - MEGA.plateauZ1) / (MEGA.dropZ1 - MEGA.plateauZ1);
  const s = t * t * (3 - 2 * t);
  return MEGA.top + (0.35 - MEGA.top) * s;
}

export function megaLandHeight(z: number): number {
  const u = z - MEGA.landZ0;
  const hill = (center: number, width: number, amp: number) => {
    const d = (u - center) / width;
    if (Math.abs(d) > 1) return 0;
    return (0.5 + 0.5 * Math.cos(d * Math.PI)) * amp;
  };
  return 0.35 + hill(16, 9, 1.5) + hill(38, 11, 2.1);
}
