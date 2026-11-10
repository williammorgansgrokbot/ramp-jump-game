import { enabledLaunch, RAMPS, type RampKind, type RampRecipe } from './catalog';

/** Half-width of the driveable heightfield. Walls sit just inside this. */
export const TRACK_HALF_WIDTH = 9;

export const SPAWN = { x: 0, y: 1.28, z: 4 };

export const LANDING = { z0: 100, z1: 160 };

/**
 * Height of the Phase 1 launch ramp. Matches the physics tune:
 * smooth rise, then a kicker so the car leaves nose-up.
 * `mega` reuses this profile so enabling that recipe already changes the hill.
 * Loop, quarter-pipe, and gap return 0 until Phase 2 adds their builders.
 */
export function heightForRamp(ramp: RampRecipe, z: number): number {
  switch (ramp.kind) {
    case 'launch':
    case 'mega':
      return launchProfile(ramp, z);
    case 'loop':
    case 'quarter-pipe':
    case 'gap':
      return 0;
    default: {
      const _never: never = ramp.kind;
      return _never;
    }
  }
}

function launchProfile(ramp: RampRecipe, z: number): number {
  const z0 = ramp.z;
  const z1 = ramp.z + ramp.length;
  if (z <= z0) return 0;
  if (z >= z1) return ramp.height + 1.1;
  const t = (z - z0) / (z1 - z0);
  const s = t * t * (3 - 2 * t);
  let h = s * ramp.height;
  if (t > 0.75) h += ((t - 0.75) / 0.25) ** 2 * 1.1;
  return h;
}

export function launchHeight(z: number): number {
  let h = 0;
  for (const ramp of RAMPS) {
    if (!ramp.enabled) continue;
    h = Math.max(h, heightForRamp(ramp, z));
  }
  return h;
}

export function landingHeight(z: number): number {
  if (z < LANDING.z0 || z > LANDING.z1) return 0;
  const u = z - LANDING.z0;
  const hill = (center: number, width: number, amp: number) => {
    const d = (u - center) / width;
    if (Math.abs(d) > 1) return 0;
    return (0.5 + 0.5 * Math.cos(d * Math.PI)) * amp;
  };
  return 0.2 + hill(8, 7, 1.2) + hill(24, 8, 1.8) + hill(42, 9, 1.1);
}

export function groundHeight(z: number): number {
  return Math.max(launchHeight(z), landingHeight(z));
}

export interface SurfaceGrid {
  id: string;
  /** Inclusive sample count along Z. The heightfield uses `samples - 1` cells. */
  samples: number;
  z0: number;
  z1: number;
  /** Height at each sample. The collider and the visual deck share this array. */
  heights: Float32Array;
}

let gridCache: SurfaceGrid[] | null = null;

function buildGrid(id: string, z0: number, z1: number, nz: number, heightAt: (z: number) => number): SurfaceGrid {
  const samples = nz + 1;
  const heights = new Float32Array(samples);
  for (let iz = 0; iz < samples; iz++) {
    const z = z0 + (iz / nz) * (z1 - z0);
    heights[iz] = heightAt(z);
  }
  return { id, samples, z0, z1, heights };
}

/** Exact Z samples used by both the heightfield collider and the visible deck. */
export function surfaceGrids(): SurfaceGrid[] {
  if (gridCache) return gridCache;
  const launch = enabledLaunch();
  const lip = launch.z + launch.length;
  gridCache = [
    buildGrid('runway-ramp', -4, lip + 4, 110, (z) => (z >= lip ? launchHeight(lip) : launchHeight(z))),
    buildGrid('landing', LANDING.z0, LANDING.z1, 60, landingHeight),
  ];
  return gridCache;
}

/** Piecewise-linear drive-surface height. Null in the jump gap and off the ends. */
export function driveSurfaceHeight(z: number): number | null {
  for (const grid of surfaceGrids()) {
    if (z < grid.z0 - 1e-3 || z > grid.z1 + 1e-3) continue;
    const f = ((z - grid.z0) / (grid.z1 - grid.z0)) * (grid.samples - 1);
    const i = Math.min(grid.samples - 2, Math.max(0, Math.floor(f)));
    const u = f - i;
    return grid.heights[i] * (1 - u) + grid.heights[i + 1] * u;
  }
  return null;
}

export interface HeightFieldSpec {
  id: string;
  nrows: number;
  ncols: number;
  heights: Float32Array;
  scale: { x: number; y: number; z: number };
  translation: { x: number; y: number; z: number };
  friction: number;
  restitution: number;
}

/**
 * Rapier heightfields: `nrows`/`ncols` are cell counts, the sample grid is
 * (nrows+1) by (ncols+1), column-major as `sampleZ + sampleX * (nrows+1)`.
 * Rows run along Z, columns along X. The field is centered on `translation`.
 */
function makeField(grid: SurfaceGrid, friction: number, restitution: number): HeightFieldSpec {
  const nx = 6;
  const nz = grid.samples - 1;
  const rows = grid.samples;
  const cols = nx + 1;
  const heights = new Float32Array(rows * cols);
  for (let iz = 0; iz < rows; iz++) {
    const h = grid.heights[iz];
    for (let ix = 0; ix < cols; ix++) heights[iz + ix * rows] = h;
  }
  return {
    id: grid.id,
    nrows: nz,
    ncols: nx,
    heights,
    scale: { x: TRACK_HALF_WIDTH * 2, y: 1, z: grid.z1 - grid.z0 },
    translation: { x: 0, y: 0, z: (grid.z0 + grid.z1) / 2 },
    friction,
    restitution,
  };
}

export function trackFields(): HeightFieldSpec[] {
  const [runway, landing] = surfaceGrids();
  return [makeField(runway, 0.95, 0.02), makeField(landing, 0.8, 0.28)];
}

export interface BoxSpec {
  center: { x: number; y: number; z: number };
  half: { x: number; y: number; z: number };
  rotX: number;
  color: number;
}

function quatPitch(angle: number): { x: number; y: number; z: number; w: number } {
  const h = angle / 2;
  return { x: Math.sin(h), y: 0, z: 0, w: Math.cos(h) };
}

export { quatPitch };

/** Low runway curbs and taller ramp rails. Straight driving never touches them. */
export function barrierBoxes(): BoxSpec[] {
  const boxes: BoxSpec[] = [];
  const launch = enabledLaunch();
  const zRun0 = 0;
  const zRun1 = launch.z - 1;
  for (const side of [-1, 1]) {
    boxes.push({
      center: { x: side * 8.15, y: 0.16, z: (zRun0 + zRun1) / 2 },
      half: { x: 0.22, y: 0.16, z: (zRun1 - zRun0) / 2 },
      rotX: 0,
      color: side < 0 ? 0xff4d6d : 0x4cc9f0,
    });
  }

  const z0 = launch.z;
  const z1 = launch.z + launch.length;
  const step = 3;
  for (let z = z0; z < z1 - 0.2; z += step) {
    const zA = z;
    const zB = Math.min(z1, z + step);
    const hA = launchHeight(zA);
    const hB = launchHeight(zB);
    const midZ = (zA + zB) / 2;
    const midH = (hA + hB) / 2;
    const pitch = -Math.atan2(hB - hA, zB - zA);
    const length = Math.hypot(zB - zA, hB - hA);
    for (const side of [-1, 1]) {
      boxes.push({
        center: { x: side * 8.15, y: midH + 0.62, z: midZ },
        half: { x: 0.2, y: 0.55, z: length / 2 },
        rotX: pitch,
        color: Math.floor((z - z0) / step) % 2 === 0 ? 0xfff1f2 : 0xff3b30,
      });
    }
  }
  return boxes;
}

export function rampKindImplemented(kind: RampKind): boolean {
  return kind === 'launch' || kind === 'mega';
}
