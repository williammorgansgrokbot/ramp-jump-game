/** Side-by-side stunt lanes. The original launch stays on x = 0. */

export type StuntId = 'launch' | 'loop' | 'quarter' | 'gap' | 'mega';

export interface Stunt {
  id: StuntId;
  laneX: number;
  spawn: { x: number; y: number; z: number };
}

export const LOOP = buildLoop();
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
 * Clothoid teardrop, taller than it is wide, with a slight helix so the
 * exit lands beside the entry. Shared by the mesh, the trimesh, and GO assist.
 */
export interface LoopFrame {
  s: number;
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  nx: number;
  ny: number;
  nz: number;
  lx: number;
  ly: number;
  lz: number;
}

export interface LoopSpec {
  laneX: number;
  halfW: number;
  /** Kept so older call sites can read a characteristic size. */
  radius: number;
  zCenter: number;
  entryZ: number;
  exitZ: number;
  exitX: number;
  midZ: number;
  height: number;
  length: number;
  frames: LoopFrame[];
}

function buildLoop(): LoopSpec {
  const laneX = 38;
  const halfW = 2.65;
  const raw = integrateTeardrop();
  const frames = frameLoop(raw);
  let height = 0;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const frame of frames) {
    if (frame.y > height) height = frame.y;
    if (frame.z < minZ) minZ = frame.z;
    if (frame.z > maxZ) maxZ = frame.z;
  }
  const entry = frames[0];
  const exit = frames[frames.length - 1];
  let mid = frames[0];
  for (const frame of frames) if (frame.y > mid.y) mid = frame;
  return {
    laneX,
    halfW,
    radius: Math.max(4, (maxZ - minZ) * 0.5),
    zCenter: entry.z,
    entryZ: entry.z,
    exitZ: exit.z,
    exitX: exit.x,
    midZ: mid.z,
    height,
    length: exit.s,
    frames,
  };
}

interface RawLoop {
  x: number;
  y: number;
  z: number;
  psi: number;
}

/** Curvature is gentle on the floor and tight over the crown. Heading is the clothoid angle. */
function integrateTeardrop(): RawLoop[] {
  const steps = 100;
  const psiEnd = Math.PI * 2;
  const kFloor = 0.1;
  const kCrown = 0.22;
  const helix = 6.8;
  const lead = 6.5;
  const curve: RawLoop[] = [];
  let x = 0;
  let y = 0;
  let z = 0;
  let psi = 0;
  const dPsi = psiEnd / steps;
  for (let i = 0; i <= steps; i++) {
    curve.push({ x, y, z, psi });
    const crown = Math.sin(psi * 0.5) ** 2;
    const kappa = kFloor + (kCrown - kFloor) * crown;
    const ds = dPsi / kappa;
    x += (helix / psiEnd) * dPsi;
    y += Math.sin(psi) * ds;
    z += Math.cos(psi) * ds;
    psi += dPsi;
  }
  const yErr = curve[curve.length - 1].y;
  for (let i = 0; i < curve.length; i++) curve[i].y -= yErr * (i / (curve.length - 1));
  const entryZ = 20;
  const originX = 38;
  const z0 = curve[0].z;
  for (const pt of curve) {
    pt.x += originX;
    pt.z += entryZ - z0;
  }
  const first = curve[0];
  const straightIn: RawLoop[] = [];
  for (let i = 0; i < 8; i++) straightIn.push({ x: first.x, y: 0, z: first.z - lead + (lead * i) / 8, psi: 0 });
  const last = curve[curve.length - 1];
  const straightOut: RawLoop[] = [];
  const outX = helix / (Math.hypot(helix, psiEnd) || 1);
  for (let i = 1; i <= 10; i++) {
    const d = (lead * i) / 10;
    straightOut.push({ x: last.x + outX * d * 0.15, y: 0, z: last.z + d, psi: Math.PI * 2 });
  }
  return [...straightIn, ...curve, ...straightOut];
}

function frameLoop(pts: RawLoop[]): LoopFrame[] {
  const frames: LoopFrame[] = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    let tz = b.z - a.z;
    const tlen = Math.hypot(tx, ty, tz) || 1;
    tx /= tlen;
    ty /= tlen;
    tz /= tlen;
    const psi = pts[i].psi;
    let nx = 0;
    let ny = Math.cos(psi);
    let nz = -Math.sin(psi);
    const dot = nx * tx + ny * ty + nz * tz;
    nx -= tx * dot;
    ny -= ty * dot;
    nz -= tz * dot;
    const nlen = Math.hypot(nx, ny, nz) || 1;
    nx /= nlen;
    ny /= nlen;
    nz /= nlen;
    let lx = ny * tz - nz * ty;
    let ly = nz * tx - nx * tz;
    let lz = nx * ty - ny * tx;
    const llen = Math.hypot(lx, ly, lz) || 1;
    lx /= llen;
    ly /= llen;
    lz /= llen;
    if (i > 0) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
    frames.push({ s, x: pts[i].x, y: Math.max(0, pts[i].y), z: pts[i].z, tx, ty, tz, nx, ny, nz, lx, ly, lz });
  }
  return frames;
}

export function sampleLoop(distance: number): LoopFrame {
  const frames = LOOP.frames;
  const end = frames[frames.length - 1].s;
  const s = Math.max(0, Math.min(end, distance));
  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].s < s) lo = mid;
    else hi = mid;
  }
  const a = frames[lo];
  const b = frames[hi];
  const span = b.s - a.s || 1;
  const u = (s - a.s) / span;
  const mix = (p: number, q: number) => p + (q - p) * u;
  return {
    s,
    x: mix(a.x, b.x),
    y: mix(a.y, b.y),
    z: mix(a.z, b.z),
    tx: mix(a.tx, b.tx),
    ty: mix(a.ty, b.ty),
    tz: mix(a.tz, b.tz),
    nx: mix(a.nx, b.nx),
    ny: mix(a.ny, b.ny),
    nz: mix(a.nz, b.nz),
    lx: mix(a.lx, b.lx),
    ly: mix(a.ly, b.ly),
    lz: mix(a.lz, b.lz),
  };
}

export function loopRibbon(): Ribbon {
  const frames = LOOP.frames;
  const cols = 6;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const frame of frames) {
    for (let k = 0; k <= cols; k++) {
      const u = -LOOP.halfW + (k / cols) * LOOP.halfW * 2;
      positions.push(frame.x + frame.lx * u, frame.y + frame.ly * u, frame.z + frame.lz * u);
    }
  }
  const row = cols + 1;
  for (let i = 0; i < frames.length - 1; i++) {
    for (let k = 0; k < cols; k++) {
      const a = i * row + k;
      indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  return { vertices: Float32Array.from(positions), indices: Uint32Array.from(indices) };
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

export function loopPose(distance: number, ride: number): {
  x: number;
  y: number;
  z: number;
  up: { x: number; y: number; z: number };
  fwd: { x: number; y: number; z: number };
  left: { x: number; y: number; z: number };
} {
  const frame = sampleLoop(distance);
  return {
    x: frame.x + frame.nx * ride,
    y: frame.y + frame.ny * ride,
    z: frame.z + frame.nz * ride,
    up: { x: frame.nx, y: frame.ny, z: frame.nz },
    fwd: { x: frame.tx, y: frame.ty, z: frame.tz },
    left: { x: frame.lx, y: frame.ly, z: frame.lz },
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
