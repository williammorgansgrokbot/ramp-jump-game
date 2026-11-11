import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GAP, LOOP, MEGA, QUARTER, gapLandHeight, gapRampHeight, megaRunHeight, type LoopFrame } from './stunts';
import { launchHeight } from './terrain';

/**
 * Named slots for the art-v6 textures. UVs are meters (across, along).
 * Drop a texture in by setting map / normalMap / roughnessMap on the material
 * with this name and clearing onBeforeCompile if you bring your own normals.
 */
export const STUNT_SLOTS = [
  'deck-track',
  'deck-stripe',
  'hazard-chevron',
  'steel-yellow',
  'rail-wall',
  'coping-pipe',
  'bumper-pad',
  'base-plate',
  'contact-ao',
] as const;

const RED = new THREE.Color('#e10600');
const BLUE = new THREE.Color('#1d4fbf');
const YELLOW = new THREE.Color('#f5c400');
const BLACK = new THREE.Color('#1a1a1a');

interface Tube {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  r: number;
}

interface Build {
  deck: THREE.BufferGeometry[];
  stripe: THREE.BufferGeometry[];
  hazard: THREE.BufferGeometry[];
  rail: THREE.BufferGeometry[];
  bumper: THREE.BufferGeometry[];
  base: THREE.BufferGeometry[];
  ao: THREE.BufferGeometry[];
  steel: Tube[];
  coping: Tube[];
}

export function buildStuntShow(): THREE.Group {
  const build: Build = {
    deck: [], stripe: [], hazard: [], rail: [], bumper: [], base: [], ao: [], steel: [], coping: [],
  };
  addLoop(build);
  addSlope(build, 0, 50, 78, 6.4, (z) => launchHeight(z), BLUE, true);
  addSlope(build, MEGA.laneX, 2, MEGA.dropZ1, 6.2, megaRunHeight, BLUE, true);
  addSlope(build, GAP.laneX, GAP.rampZ0, GAP.rampZ1 + 0.2, 6.0, gapRampHeight, BLUE, true);
  addSlope(build, GAP.laneX, GAP.landZ0 - 0.2, GAP.landZ0 + 22, 6.0, gapLandHeight, BLUE, false);
  addQuarter(build);

  const group = new THREE.Group();
  group.name = 'stunt-show';
  const deckMat = slot('deck-track', {
    color: 0xffffff,
    roughness: 0.46,
    metalness: 0.18,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  pushMerged(group, build.deck, deckMat, true);
  pushMerged(group, build.stripe, slot('deck-stripe', { color: 0xf7f7f2, roughness: 0.4, metalness: 0.08 }), false);
  pushMerged(group, build.hazard, slot('hazard-chevron', { color: 0xffffff, roughness: 0.5, metalness: 0.05, vertexColors: true }), false);
  pushMerged(group, build.rail, slot('rail-wall', { color: 0xf4f1ea, roughness: 0.42, metalness: 0.22, side: THREE.DoubleSide }), true);
  pushMerged(group, build.bumper, slot('bumper-pad', { color: 0xff4d4d, roughness: 0.78, metalness: 0.02 }), true);
  pushMerged(group, build.base, slot('base-plate', { color: 0x2e3440, roughness: 0.62, metalness: 0.45 }), true);
  const ao = slot('contact-ao', { color: 0x000000, transparent: true, opacity: 0.32, roughness: 1, depthWrite: false });
  pushMerged(group, build.ao, ao, false);
  group.add(tubeMesh('steel-yellow', build.steel, slot('steel-yellow', { color: 0xf5c400, roughness: 0.36, metalness: 0.74 })));
  group.add(tubeMesh('coping-pipe', build.coping, slot('coping-pipe', { color: 0xd5dde6, roughness: 0.28, metalness: 0.82 })));
  return group;
}

function slot(name: string, params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial(params);
  material.name = name;
  return material;
}

function pushMerged(group: THREE.Group, geos: THREE.BufferGeometry[], material: THREE.Material, shadow: boolean): void {
  const merged = geos.length ? mergeGeometries(geos, false) : null;
  for (const geo of geos) geo.dispose();
  if (!merged) return;
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = material.name;
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  group.add(mesh);
}

function tubeMesh(name: string, tubes: Tube[], material: THREE.MeshStandardMaterial): THREE.InstancedMesh {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, tubes.length));
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  tubes.forEach((tube, index) => {
    dir.set(tube.bx - tube.ax, tube.by - tube.ay, tube.bz - tube.az);
    const len = dir.length() || 0.001;
    dummy.position.set((tube.ax + tube.bx) * 0.5, (tube.ay + tube.by) * 0.5, (tube.az + tube.bz) * 0.5);
    dummy.quaternion.setFromUnitVectors(up, dir.multiplyScalar(1 / len));
    dummy.scale.set(tube.r, len, tube.r);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  });
  mesh.count = Math.max(1, tubes.length);
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function addLoop(build: Build): void {
  const frames = LOOP.frames;
  const color = frames.map(() => RED);
  build.deck.push(sweep(frames, LOOP.halfW, 8, color, 0.02));
  build.stripe.push(sweep(frames, LOOP.halfW, 1, color, 0.035, 0.34));
  build.stripe.push(sweep(frames, -LOOP.halfW, 1, color, 0.035, 0.34));
  build.rail.push(wall(frames, LOOP.halfW, 0.78));
  build.rail.push(wall(frames, -LOOP.halfW, 0.78));
  const stride = 4;
  let prevL: THREE.Vector3 | null = null;
  let prevR: THREE.Vector3 | null = null;
  for (let i = 0; i < frames.length; i += stride) {
    const frame = frames[i];
    if (frame.y < 1.4) {
      prevL = null;
      prevR = null;
      continue;
    }
    for (const side of [-1, 1]) {
      const edge = offset(frame, side * (LOOP.halfW + 0.15), 0);
      const chord = offset(frame, side * (LOOP.halfW + 1.05), -0.85);
      chord.y = Math.max(0.45, chord.y);
      build.steel.push(tube(edge, chord, 0.07));
      const prev = side < 0 ? prevL : prevR;
      if (prev) build.steel.push(tube(prev, chord, 0.08));
      if (side < 0) prevL = chord;
      else prevR = chord;
    }
  }
  const crown = frames.reduce((best, frame) => (frame.y > best.y ? frame : best), frames[0]);
  for (const side of [-1, 1]) {
    const footX = crown.x + side * (LOOP.halfW + 2.4);
    const top = offset(crown, side * (LOOP.halfW + 0.4), 0.2);
    build.steel.push({ ax: footX - side * 1.3, ay: 0.15, az: crown.z - 1.4, bx: top.x, by: top.y, bz: top.z, r: 0.1 });
    build.steel.push({ ax: footX + side * 1.3, ay: 0.15, az: crown.z + 1.4, bx: top.x, by: top.y, bz: top.z, r: 0.1 });
    build.steel.push({ ax: footX - side * 1.3, ay: 1.4, az: crown.z - 1.4, bx: footX + side * 1.3, by: 1.4, bz: crown.z + 1.4, r: 0.07 });
    build.base.push(box(footX, 0.06, crown.z, 2.4, 0.06, 1.6));
    build.ao.push(disc(footX, crown.z, 2.8));
  }
  build.ao.push(disc(LOOP.laneX, LOOP.entryZ + 1, 4.2));
  build.ao.push(disc(LOOP.exitX, LOOP.exitZ, 4.2));
}

interface PathPoint {
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
  s: number;
}

function addSlope(
  build: Build,
  lane: number,
  z0: number,
  z1: number,
  half: number,
  heightAt: (z: number) => number,
  color: THREE.Color,
  chevron: boolean,
): void {
  const frames = slopeFrames(lane, z0, z1, heightAt);
  const colors = frames.map(() => color);
  build.deck.push(sweep(frames, half, 6, colors, 0.045));
  build.stripe.push(sweep(frames, half, 1, colors, 0.06, 0.32));
  build.stripe.push(sweep(frames, -half, 1, colors, 0.06, 0.32));
  build.rail.push(wall(frames, half, 0.62));
  build.rail.push(wall(frames, -half, 0.62));
  if (chevron) build.hazard.push(chevronStrip(frames, half));
  let prev: { l: THREE.Vector3; r: THREE.Vector3 } | null = null;
  for (let i = 0; i < frames.length; i += 5) {
    const frame = frames[i];
    if (frame.y < 0.8) continue;
    const l = offset(frame, -(half + 0.35), -0.35);
    const r = offset(frame, half + 0.35, -0.35);
    l.y = Math.max(0.35, frame.y - 0.55);
    r.y = l.y;
    build.steel.push(tube(new THREE.Vector3(frame.x - half, 0.2, frame.z), l, 0.08));
    build.steel.push(tube(new THREE.Vector3(frame.x + half, 0.2, frame.z), r, 0.08));
    if (prev) {
      build.steel.push(tube(prev.l, l, 0.07));
      build.steel.push(tube(prev.r, r, 0.07));
      build.steel.push(tube(l, r, 0.06));
    }
    prev = { l, r };
  }
  const lip = frames[frames.length - 1];
  for (const side of [-1, 1]) {
    const pad = offset(lip, side * (half - 0.35), 0.15);
    build.bumper.push(box(pad.x, pad.y + 0.18, pad.z, 0.28, 0.16, 0.55));
  }
  build.ao.push(disc(lane, z0 + 1.5, half * 0.7));
}

function addQuarter(build: Build): void {
  const { radius: r, z0, laneX, halfW } = QUARTER;
  const steps = 42;
  const max = Math.PI * 0.46;
  const raw: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * max;
    raw.push({ x: laneX, y: r * (1 - Math.cos(theta)), z: z0 + r * Math.sin(theta) });
  }
  const lip = raw[raw.length - 1];
  for (let i = 1; i <= 8; i++) raw.push({ x: laneX, y: lip.y, z: lip.z + i * 0.8 });
  const frames = framesFromPoints(raw);
  build.deck.push(sweep(frames, halfW, 6, frames.map(() => BLUE), 0.03));
  build.stripe.push(sweep(frames, halfW, 1, frames.map(() => BLUE), 0.045, 0.3));
  build.stripe.push(sweep(frames, -halfW, 1, frames.map(() => BLUE), 0.045, 0.3));
  build.rail.push(wall(frames, halfW, 0.55));
  build.rail.push(wall(frames, -halfW, 0.55));
  const curve = frames.slice(0, steps + 1);
  let prevL: THREE.Vector3 | null = null;
  let prevR: THREE.Vector3 | null = null;
  for (let i = 0; i < curve.length; i += 4) {
    const frame = curve[i];
    for (const side of [-1, 1]) {
      const edge = offset(frame, side * halfW, 0.05);
      const foot = new THREE.Vector3(frame.x + side * (halfW + 0.2), 0.2, frame.z);
      if (frame.y > 0.6) build.steel.push(tube(foot, edge, 0.07));
      const prev = side < 0 ? prevL : prevR;
      if (prev && frame.y > 0.4) build.steel.push(tube(prev, edge, 0.06));
      if (side < 0) prevL = edge;
      else prevR = edge;
    }
  }
  for (const side of [-1, 1]) {
    const a = offset(curve[Math.floor(curve.length * 0.72)], side * halfW, 0.16);
    const b = offset(curve[curve.length - 1], side * halfW, 0.16);
    build.coping.push(tube(a, b, 0.14));
  }
  const mid = offset(curve[curve.length - 1], 0, 0.16);
  build.coping.push(tube(
    offset(curve[curve.length - 1], -halfW, 0.16),
    offset(curve[curve.length - 1], halfW, 0.16),
    0.14,
  ));
  build.ao.push(disc(laneX, z0 + 1, 3.4));
}

function slopeFrames(lane: number, z0: number, z1: number, heightAt: (z: number) => number): PathPoint[] {
  const steps = Math.max(12, Math.round((z1 - z0) / 0.85));
  const raw: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const z = z0 + ((z1 - z0) * i) / steps;
    raw.push({ x: lane, y: heightAt(z) + 0.02, z });
  }
  return framesFromPoints(raw);
}

function framesFromPoints(raw: { x: number; y: number; z: number }[]): PathPoint[] {
  const frames: PathPoint[] = [];
  let s = 0;
  for (let i = 0; i < raw.length; i++) {
    const a = raw[Math.max(0, i - 1)];
    const b = raw[Math.min(raw.length - 1, i + 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    let tz = b.z - a.z;
    const tlen = Math.hypot(tx, ty, tz) || 1;
    tx /= tlen;
    ty /= tlen;
    tz /= tlen;
    const lx = 1;
    const ly = 0;
    const lz = 0;
    let nx = ly * tz - lz * ty;
    let ny = lz * tx - lx * tz;
    let nz = lx * ty - ly * tx;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const nlen = Math.hypot(nx, ny, nz) || 1;
    nx /= nlen;
    ny /= nlen;
    nz /= nlen;
    if (i > 0) s += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y, raw[i].z - raw[i - 1].z);
    frames.push({
      x: raw[i].x, y: raw[i].y, z: raw[i].z, tx, ty, tz, nx, ny, nz, lx, ly, lz, s,
    });
  }
  return frames;
}

function sweep(frames: PathPoint[] | LoopFrame[], half: number, cols: number, colors: THREE.Color[], lift: number, stripe = 0): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colsAttr: number[] = [];
  const indices: number[] = [];
  const across = Math.max(1, cols);
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    for (let k = 0; k <= across; k++) {
      const u = stripe > 0
        ? half + Math.sign(half || 1) * (-stripe + (k / across) * stripe)
        : -half + (k / across) * half * 2;
      positions.push(
        frame.x + frame.lx * u + frame.nx * lift,
        frame.y + frame.ly * u + frame.ny * lift,
        frame.z + frame.lz * u + frame.nz * lift,
      );
      normals.push(frame.nx, frame.ny, frame.nz);
      uvs.push(u, frame.s);
      const color = colors[Math.min(colors.length - 1, i)];
      colsAttr.push(color.r, color.g, color.b);
    }
  }
  const row = across + 1;
  for (let i = 0; i < frames.length - 1; i++) {
    for (let k = 0; k < across; k++) {
      const a = i * row + k;
      indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colsAttr, 3));
  geo.setIndex(indices);
  return geo;
}

function wall(frames: Array<PathPoint | LoopFrame>, edge: number, height: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const side = Math.sign(edge) || 1;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    for (const h of [0, height]) {
      positions.push(
        frame.x + frame.lx * edge + frame.nx * (0.04 + h),
        frame.y + frame.ly * edge + frame.ny * (0.04 + h),
        frame.z + frame.lz * edge + frame.nz * (0.04 + h),
      );
      normals.push(frame.lx * side, frame.ly * side, frame.lz * side);
      uvs.push(frame.s, h);
    }
  }
  for (let i = 0; i < frames.length - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function chevronStrip(frames: PathPoint[], half: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const start = Math.max(0, frames.length - 4);
  for (let i = start; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    const yellow = (i - start) % 2 === 0;
    const color = yellow ? YELLOW : BLACK;
    for (const u of [-half + 0.4, half - 0.4]) {
      for (const frame of [a, b]) {
        positions.push(frame.x + frame.lx * u + frame.nx * 0.07, frame.y + frame.ny * 0.07, frame.z + frame.nz * 0.07);
        colors.push(color.r, color.g, color.b);
        uvs.push(u, frame.s);
      }
    }
  }
  const indices: number[] = [];
  const quads = positions.length / 3 / 4;
  for (let q = 0; q < quads; q++) {
    const a = q * 4;
    indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function offset(frame: { x: number; y: number; z: number; lx: number; ly: number; lz: number; nx: number; ny: number; nz: number }, lateral: number, normal: number): THREE.Vector3 {
  return new THREE.Vector3(
    frame.x + frame.lx * lateral + frame.nx * normal,
    frame.y + frame.ly * lateral + frame.ny * normal,
    frame.z + frame.lz * lateral + frame.nz * normal,
  );
}

function tube(a: THREE.Vector3, b: THREE.Vector3, r: number): Tube {
  return { ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, r };
}

function box(x: number, y: number, z: number, hx: number, hy: number, hz: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
  geo.translate(x, y, z);
  return geo;
}

function disc(x: number, z: number, radius: number): THREE.BufferGeometry {
  const geo = new THREE.CircleGeometry(radius, 14);
  geo.rotateX(-Math.PI / 2);
  geo.translate(x, 0.03, z);
  return geo;
}
