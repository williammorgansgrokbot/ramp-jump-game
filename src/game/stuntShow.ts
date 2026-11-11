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
  'loop-track',
  'plywood-lanes',
  'diamond-plate',
  'deck-stripe',
  'hazard-chevron',
  'hazard-edge',
  'steel-yellow',
  'steel-blue',
  'shell-steel',
  'rail-wall',
  'coping-pipe',
  'bumper-pad',
  'contact-ao',
] as const;

const WHITE = new THREE.Color('#ffffff');

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
  loopDeck: THREE.BufferGeometry[];
  ply: THREE.BufferGeometry[];
  diamond: THREE.BufferGeometry[];
  stripe: THREE.BufferGeometry[];
  hazard: THREE.BufferGeometry[];
  hazardEdge: THREE.BufferGeometry[];
  rail: THREE.BufferGeometry[];
  shell: THREE.BufferGeometry[];
  bumper: THREE.BufferGeometry[];
  ao: THREE.BufferGeometry[];
  foot: THREE.BufferGeometry[];
  steel: Tube[];
  steelBlue: Tube[];
  coping: Tube[];
  nodes: THREE.Vector3[];
  nodesBlue: THREE.Vector3[];
}

export async function buildStuntShow(opts: { base: string; mobile: boolean }): Promise<THREE.Group> {
  const build: Build = {
    deck: [], loopDeck: [], ply: [], diamond: [], stripe: [], hazard: [], hazardEdge: [],
    rail: [], shell: [], bumper: [], ao: [], foot: [], steel: [], steelBlue: [], coping: [],
    nodes: [], nodesBlue: [],
  };
  addLoop(build);
  addSlope(build, build.steel, build.deck, 0, 50, 78, 6.4, (z) => launchHeight(z), true);
  addSlope(build, build.steel, build.deck, MEGA.laneX, 2, MEGA.dropZ1, 6.2, megaRunHeight, true, true);
  addSlope(build, build.steelBlue, build.deck, GAP.laneX, GAP.rampZ0, GAP.rampZ1 + 0.2, 6.0, gapRampHeight, true);
  addSlope(build, build.steelBlue, build.diamond, GAP.laneX, GAP.landZ0 - 0.2, GAP.landZ0 + 22, 6.0, gapLandHeight, false);
  addQuarter(build);

  const size = opts.mobile ? '512' : '1024';
  const tex = await loadArt(opts.base, size);
  const group = new THREE.Group();
  group.name = 'stunt-show';

  const deckMat = slot('deck-track', { color: 0xffffff, roughness: 1, metalness: 0.16 });
  paint(deckMat, tex.deck, tex.deckN, tex.deckR, 1 / 2, 1 / 2, true);
  pushMerged(group, build.deck, deckMat, true);

  const loopMat = slot('loop-track', { color: 0xffffff, roughness: 1, metalness: 0.12 });
  paint(loopMat, tex.loop, null, tex.loopR, 1, 1 / 5.5, false);
  pushMerged(group, build.loopDeck, loopMat, true);

  const plyMat = slot('plywood-lanes', { color: 0xffffff, roughness: 1, metalness: 0.04 });
  paint(plyMat, tex.ply, tex.plyN, tex.plyR, 1, 1 / 3.5, false);
  pushMerged(group, build.ply, plyMat, true);

  const diamondMat = slot('diamond-plate', { color: 0xffffff, roughness: 1, metalness: 0.55 });
  paint(diamondMat, tex.diamond, tex.diamondN, tex.diamondR, 1 / 0.8, 1 / 0.8, true);
  pushMerged(group, build.diamond, diamondMat, true);

  pushMerged(group, build.stripe, slot('deck-stripe', { color: 0xf7f7f2, roughness: 0.4, metalness: 0.08 }), false);

  const chevronMat = slot('hazard-chevron', { color: 0xffffff, roughness: 0.55, metalness: 0.04 });
  paint(chevronMat, tex.chevron, null, null, 1 / 2, 1, true);
  pushMerged(group, build.hazard, chevronMat, false);

  const edgeMat = slot('hazard-edge', { color: 0xffffff, roughness: 0.5, metalness: 0.05 });
  paint(edgeMat, tex.hazard, null, null, 1 / 2, 1, true);
  pushMerged(group, build.hazardEdge, edgeMat, false);

  const shellMat = slot('shell-steel', {
    color: 0xc5c9d0,
    roughness: 0.42,
    metalness: 0.62,
    normalMap: panelNormal(),
    normalScale: new THREE.Vector2(0.35, 0.35),
    side: THREE.FrontSide,
  });
  if (shellMat.normalMap) {
    shellMat.normalMap.repeat.set(1 / 1.25, 1 / 1.25);
  }
  pushMerged(group, build.shell, shellMat, true);
  pushMerged(group, build.rail, slot('rail-wall', { color: 0xf4f1ea, roughness: 0.42, metalness: 0.22 }), true);
  pushMerged(group, build.bumper, slot('bumper-pad', { color: 0xff4d4d, roughness: 0.78, metalness: 0.02 }), true);

  const ao = slot('contact-ao', { color: 0x000000, transparent: true, opacity: 0.62, roughness: 1, depthWrite: false });
  pushMerged(group, build.ao, ao, false);
  const footMat = new THREE.MeshBasicMaterial({
    name: 'contact-footprint',
    map: softFootprint(),
    transparent: true,
    depthWrite: false,
    color: 0x000000,
  });
  footMat.polygonOffset = true;
  footMat.polygonOffsetFactor = -1;
  pushMerged(group, build.foot, footMat, false);

  const yellow = slot('steel-yellow', { color: 0xffffff, roughness: 1, metalness: 0.62 });
  paint(yellow, tex.yellow, null, tex.yellowR, 1, 1, true);
  const yellowNodes = yellow.clone();
  tubePaint(yellow);
  group.add(tubeMesh('steel-yellow', build.steel, yellow));
  group.add(nodeMesh('steel-yellow', build.nodes, yellowNodes));

  const blue = slot('steel-blue', { color: 0xffffff, roughness: 1, metalness: 0.62 });
  paint(blue, tex.blue, null, tex.blueR, 1, 1, true);
  const blueNodes = blue.clone();
  tubePaint(blue);
  group.add(tubeMesh('steel-blue', build.steelBlue, blue));
  group.add(nodeMesh('steel-blue', build.nodesBlue, blueNodes));

  group.add(tubeMesh('coping-pipe', build.coping, slot('coping-pipe', { color: 0xd5dde6, roughness: 0.28, metalness: 0.82 })));
  return group;
}

interface ArtTex {
  deck: THREE.Texture | null;
  deckN: THREE.Texture | null;
  deckR: THREE.Texture | null;
  loop: THREE.Texture | null;
  loopR: THREE.Texture | null;
  ply: THREE.Texture | null;
  plyN: THREE.Texture | null;
  plyR: THREE.Texture | null;
  diamond: THREE.Texture | null;
  diamondN: THREE.Texture | null;
  diamondR: THREE.Texture | null;
  yellow: THREE.Texture | null;
  yellowR: THREE.Texture | null;
  blue: THREE.Texture | null;
  blueR: THREE.Texture | null;
  chevron: THREE.Texture | null;
  hazard: THREE.Texture | null;
}

async function loadArt(base: string, size: string): Promise<ArtTex> {
  const file = (name: string) => loadTex(`${base}art/stunts/v6/${name}_${size}.webp`, true);
  const data = (name: string) => loadTex(`${base}art/stunts/v6/${name}_${size}.webp`, false);
  const [deck, deckN, deckR, loop, loopR, ply, plyN, plyR, diamond, diamondN, diamondR, yellow, yellowR, blue, blueR, chevron, hazard] = await Promise.all([
    file('deck_red'), data('deck_red_normal'), data('deck_red_rough'),
    file('loop_track'), data('loop_track_rough'),
    file('plywood_lanes'), data('plywood_lanes_normal'), data('plywood_lanes_rough'),
    file('diamond'), data('diamond_normal'), data('diamond_rough'),
    file('truss_yellow'), data('truss_yellow_rough'),
    file('truss_blue'), data('truss_blue_rough'),
    file('chevron_yellow_black'),
    file('hazard_red_white'),
  ]);
  return { deck, deckN, deckR, loop, loopR, ply, plyN, plyR, diamond, diamondN, diamondR, yellow, yellowR, blue, blueR, chevron, hazard };
}

function loadTex(url: string, color: boolean): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(url, (tex) => {
      tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      resolve(tex);
    }, undefined, () => resolve(null));
  });
}

function paint(
  material: THREE.MeshStandardMaterial,
  map: THREE.Texture | null,
  normal: THREE.Texture | null,
  rough: THREE.Texture | null,
  repeatX: number,
  repeatY: number,
  repeatAcross: boolean,
): void {
  const tune = (tex: THREE.Texture | null) => {
    if (!tex) return null;
    tex.repeat.set(repeatX, repeatY);
    tex.wrapS = repeatAcross ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  };
  material.map = tune(map);
  material.normalMap = tune(normal);
  material.roughnessMap = tune(rough);
  if (normal) material.normalScale = new THREE.Vector2(0.85, 0.85);
  material.needsUpdate = true;
}

function tubePaint(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying vec2 vTubeUv;\n${shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
         vTubeUv = vec2(uv.x * length(instanceMatrix[0].xyz) * 6.283185, uv.y * length(instanceMatrix[1].xyz));
       #else
         vTubeUv = uv;
       #endif`,
    )}`;
    shader.fragmentShader = `varying vec2 vTubeUv;\n${shader.fragmentShader}`
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          diffuseColor *= texture2D( map, vTubeUv );
        #endif`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
         #ifdef USE_ROUGHNESSMAP
           roughnessFactor *= texture2D( roughnessMap, vTubeUv ).g;
         #endif`,
      );
  };
}

function panelNormal(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const data = ctx?.createImageData(size, size);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const seam = x % 32 < 2 || y % 32 < 2 ? 0.35 : 1;
      height[y * size + x] = seam;
    }
  }
  if (data) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const xm = height[y * size + (x + size - 1) % size];
        const xp = height[y * size + (x + 1) % size];
        const ym = height[((y + size - 1) % size) * size + x];
        const yp = height[((y + 1) % size) * size + x];
        const nx = (xm - xp) * 2;
        const ny = (ym - yp) * 2;
        const nz = 1;
        const len = Math.hypot(nx, ny, nz) || 1;
        const i = (y * size + x) * 4;
        data.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
        data.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
        data.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
        data.data[i + 3] = 255;
      }
    }
    ctx?.putImageData(data, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
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

function nodeMesh(name: string, points: THREE.Vector3[], material: THREE.MeshStandardMaterial): THREE.InstancedMesh {
  const unique: THREE.Vector3[] = [];
  for (const point of points) {
    if (!unique.some((kept) => kept.distanceToSquared(point) < 0.05)) unique.push(point);
  }
  const geo = new THREE.SphereGeometry(1, 8, 6);
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, unique.length));
  mesh.name = name;
  mesh.castShadow = true;
  const dummy = new THREE.Object3D();
  unique.forEach((point, index) => {
    dummy.position.copy(point);
    dummy.scale.setScalar(0.16);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  });
  mesh.count = Math.max(1, unique.length);
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function chain(steel: Tube[], nodes: THREE.Vector3[], points: THREE.Vector3[], radius: number): void {
  if (!points.length) return;
  nodes.push(points[0]);
  for (let i = 1; i < points.length; i++) {
    steel.push(tube(points[i - 1], points[i], radius));
    nodes.push(points[i]);
  }
}

function addLoop(build: Build): void {
  const frames = LOOP.frames;
  const tint = frames.map(() => WHITE);
  build.loopDeck.push(sweep(frames, LOOP.halfW, 8, tint, 0.02, 0, 'span'));
  build.shell.push(sweep(frames, LOOP.halfW, 6, tint, -0.14, 0, 'meters'));
  build.shell.push(beveledWall(frames, LOOP.halfW, 0.95));
  build.shell.push(beveledWall(frames, -LOOP.halfW, 0.95));
  build.hazardEdge.push(edgeBand(frames, 0, 5, LOOP.halfW));
  build.hazardEdge.push(edgeBand(frames, frames.length - 6, frames.length - 1, LOOP.halfW));

  const arch = frames.filter((frame) => frame.y > 0.45);
  const samples: LoopFrame[] = [];
  let nextS = -1;
  for (const frame of arch) {
    if (frame.s < nextS) continue;
    samples.push(frame);
    nextS = frame.s + 1.05;
  }
  if (samples.length < 2) return;

  const sideLine = (side: number) => samples.map((frame) => offset(frame, side * (LOOP.halfW + 0.62), 0.08));
  const left = sideLine(-1);
  const right = sideLine(1);
  const r = 0.125;
  chain(build.steel, build.nodes, left, r);
  chain(build.steel, build.nodes, right, r);

  let ribS = -10;
  for (let i = 0; i < samples.length; i++) {
    const frame = samples[i];
    if (frame.s - ribS < 2.4) continue;
    ribS = frame.s;
    const edgeL = offset(frame, -(LOOP.halfW + 0.04), 0.22);
    const edgeR = offset(frame, LOOP.halfW + 0.04, 0.22);
    build.steel.push(tube(edgeL, left[i], r));
    build.steel.push(tube(edgeR, right[i], r));
    build.nodes.push(edgeL, edgeR, left[i], right[i]);
  }

  const wall = arch.filter((frame) => frame.y > 4 && frame.y < 10);
  if (wall.length) {
    const three = wall.reduce((best, frame) => (frame.z > best.z ? frame : best));
    const nine = wall.reduce((best, frame) => (frame.z < best.z ? frame : best));
    addTower(build, three, 1, samples, right);
    addTower(build, nine, -1, samples, left);
  }

  for (let i = 0; i < frames.length; i += 8) {
    const frame = frames[i];
    build.ao.push(disc(frame.x, frame.z, frame.y > 2 ? 3.2 : 4.2));
  }
}

function addTower(build: Build, frame: LoopFrame, side: number, samples: LoopFrame[], line: THREE.Vector3[]): void {
  let apexI = 0;
  let best = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const d = Math.hypot(samples[i].x - frame.x, samples[i].y - frame.y, samples[i].z - frame.z);
    if (d < best) {
      best = d;
      apexI = i;
    }
  }
  const apex = line[apexI];
  const zDir = Math.sign(frame.z - LOOP.midZ) || 1;
  const footA = new THREE.Vector3(apex.x + side * 1.7, 0.14, frame.z + zDir * 0.4);
  const footB = new THREE.Vector3(apex.x + side * 1.7, 0.14, frame.z + zDir * 3.1);
  const leg = 0.16;
  build.steel.push(tube(footA, apex, leg), tube(footB, apex, leg));
  build.nodes.push(apex, footA, footB);
  build.diamond.push(plate(footA.x, 0.05, footA.z, 0.85, 0.6), plate(footB.x, 0.05, footB.z, 0.85, 0.6));
  build.ao.push(disc(footA.x, footA.z, 1.8), disc(footB.x, footB.z, 1.8));

  const braceAt = [apexI + 4, apexI - 4].map((index) => line[Math.max(0, Math.min(line.length - 1, index))]);
  build.steel.push(tube(footA, braceAt[0], 0.12), tube(footB, braceAt[1], 0.12));
  build.nodes.push(braceAt[0], braceAt[1]);
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
  steel: Tube[],
  deck: THREE.BufferGeometry[],
  lane: number,
  z0: number,
  z1: number,
  half: number,
  heightAt: (z: number) => number,
  chevron: boolean,
  dense = false,
): void {
  const frames = slopeFrames(lane, z0, z1, heightAt);
  const colors = frames.map(() => WHITE);
  deck.push(sweep(frames, half, 6, colors, 0.045));
  build.stripe.push(sweep(frames, half, 1, colors, 0.06, 0.32));
  build.stripe.push(sweep(frames, -half, 1, colors, 0.06, 0.32));
  build.rail.push(wall(frames, half, 0.55));
  build.rail.push(wall(frames, -half, 0.55));
  if (chevron) build.hazard.push(chevronStrip(frames, half));
  const nodes = steel === build.steel ? build.nodes : build.nodesBlue;
  const spacing = dense ? 1.7 : 2.3;
  const legR = dense ? 0.2 : 0.14;
  let prev: { l: THREE.Vector3; r: THREE.Vector3; footL: THREE.Vector3; footR: THREE.Vector3 } | null = null;
  let lastZ = -1e9;
  for (const frame of frames) {
    if (frame.y < 0.9 || frame.z - lastZ < spacing) continue;
    lastZ = frame.z;
    const l = offset(frame, -(half + 0.15), -0.2);
    const r = offset(frame, half + 0.15, -0.2);
    const footL = new THREE.Vector3(frame.x - half - 0.15, 0.12, frame.z);
    const footR = new THREE.Vector3(frame.x + half + 0.15, 0.12, frame.z);
    steel.push(tube(footL, l, legR), tube(footR, r, legR), tube(l, r, dense ? 0.13 : 0.1));
    nodes.push(l, r, footL, footR);
    if (dense) {
      steel.push(tube(footL, footR, 0.11));
      build.diamond.push(plate(footL.x, 0.05, footL.z, 0.55, 0.42), plate(footR.x, 0.05, footR.z, 0.55, 0.42));
    }
    if (prev) {
      steel.push(tube(prev.l, l, dense ? 0.12 : 0.1), tube(prev.r, r, dense ? 0.12 : 0.1));
      steel.push(tube(prev.footL, footL, dense ? 0.1 : 0.08), tube(prev.footR, footR, dense ? 0.1 : 0.08));
      steel.push(tube(prev.footL, l, dense ? 0.12 : 0.08), tube(prev.l, footL, dense ? 0.12 : 0.08));
      steel.push(tube(prev.footR, r, dense ? 0.12 : 0.08), tube(prev.r, footR, dense ? 0.12 : 0.08));
      nodes.push(prev.l, prev.r, prev.footL, prev.footR);
    }
    prev = { l, r, footL, footR };
  }
  const lip = frames[frames.length - 1];
  for (const side of [-1, 1]) {
    const pad = offset(lip, side * (half - 0.35), 0.15);
    build.bumper.push(box(pad.x, pad.y + 0.18, pad.z, 0.28, 0.16, 0.55));
  }
  if (dense) build.foot.push(footprint(frames, half + 1.1));
  else {
    build.ao.push(disc(lane, z0 + 2, half * 0.45));
    build.ao.push(disc(lane, (z0 + z1) * 0.5, half * 0.4));
  }
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
  const curve = frames.slice(0, steps + 1);
  const platform = frames.slice(steps);
  const white = frames.map(() => WHITE);
  build.deck.push(sweep(curve, halfW, 6, white, 0.03));
  build.ply.push(sweep(platform, halfW, 4, white.slice(0, platform.length), 0.04, 0, 'span'));
  build.stripe.push(sweep(frames, halfW, 1, white, 0.045, 0.3));
  build.stripe.push(sweep(frames, -halfW, 1, white, 0.045, 0.3));
  build.rail.push(wall(frames, halfW, 0.55));
  build.rail.push(wall(frames, -halfW, 0.55));
  let prevL: THREE.Vector3 | null = null;
  let prevR: THREE.Vector3 | null = null;
  for (let i = 0; i < curve.length; i += 4) {
    const frame = curve[i];
    for (const side of [-1, 1]) {
      const edge = offset(frame, side * halfW, 0.05);
      const foot = new THREE.Vector3(frame.x + side * (halfW + 0.2), 0.2, frame.z);
      if (frame.y > 0.6) build.steel.push(tube(foot, edge, 0.18));
      const prev = side < 0 ? prevL : prevR;
      if (prev && frame.y > 0.4) build.steel.push(tube(prev, edge, 0.16));
      if (side < 0) prevL = edge;
      else prevR = edge;
    }
  }
  for (const side of [-1, 1]) {
    const a = offset(curve[Math.floor(curve.length * 0.72)], side * halfW, 0.16);
    const b = offset(curve[curve.length - 1], side * halfW, 0.16);
    build.coping.push(tube(a, b, 0.14));
  }
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

function sweep(
  frames: PathPoint[] | LoopFrame[],
  half: number,
  cols: number,
  colors: THREE.Color[],
  lift: number,
  stripe = 0,
  uvMode: 'meters' | 'span' = 'meters',
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
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
      const flip = lift < 0 ? -1 : 1;
      normals.push(frame.nx * flip, frame.ny * flip, frame.nz * flip);
      const acrossU = uvMode === 'span' ? (u / (Math.abs(half) * 2) + 0.5) : u;
      uvs.push(acrossU, frame.s);
      void colors;
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
  const start = Math.max(0, frames.length - 3);
  return band(frames.slice(start), half, 0.08);
}

function edgeBand(frames: LoopFrame[], from: number, to: number, half: number): THREE.BufferGeometry {
  const slice = frames.slice(Math.max(0, from), Math.min(frames.length, to + 1));
  return band(slice, half, 0.05);
}

function band(frames: Array<PathPoint | LoopFrame>, half: number, lift: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  if (frames.length < 2) return new THREE.BufferGeometry();
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const v = i / (frames.length - 1);
    for (const u of [-half + 0.35, half - 0.35]) {
      positions.push(
        frame.x + frame.lx * u + frame.nx * lift,
        frame.y + frame.ly * u + frame.ny * lift,
        frame.z + frame.lz * u + frame.nz * lift,
      );
      uvs.push(u + half, v);
    }
  }
  for (let i = 0; i < frames.length - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}

function beveledWall(frames: LoopFrame[], edge: number, height: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const side = Math.sign(edge) || 1;
  const flare = 0.16;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const rows = [
      { h: 0, out: 0, nx: frame.lx * side, ny: frame.ly * side, nz: frame.lz * side },
      { h: height * 0.82, out: flare * 0.35, nx: frame.lx * side, ny: frame.ly * side, nz: frame.lz * side },
      { h: height, out: flare, nx: frame.nx * 0.65 + frame.lx * side * 0.75, ny: frame.ny * 0.65 + frame.ly * side * 0.75, nz: frame.nz * 0.65 + frame.lz * side * 0.75 },
    ];
    for (const row of rows) {
      const nlen = Math.hypot(row.nx, row.ny, row.nz) || 1;
      positions.push(
        frame.x + frame.lx * (edge + side * row.out) + frame.nx * (0.02 + row.h),
        frame.y + frame.ly * (edge + side * row.out) + frame.ny * (0.02 + row.h),
        frame.z + frame.lz * (edge + side * row.out) + frame.nz * (0.02 + row.h),
      );
      normals.push(row.nx / nlen, row.ny / nlen, row.nz / nlen);
      uvs.push(frame.s, row.h);
    }
  }
  const row = 3;
  for (let i = 0; i < frames.length - 1; i++) {
    for (let k = 0; k < row - 1; k++) {
      const a = i * row + k;
      indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function plate(x: number, y: number, z: number, hx: number, hz: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(hx * 2, 0.1, hz * 2);
  geo.translate(x, y, z);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
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

function footprint(frames: PathPoint[], half: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const along = frames.length === 1 ? 0.5 : i / (frames.length - 1);
    positions.push(frame.x - half, 0.045, frame.z, frame.x + half, 0.045, frame.z);
    uvs.push(0, along, 1, along);
  }
  for (let i = 0; i < frames.length - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}

function softFootprint(): THREE.Texture {
  const width = 128;
  const height = 64;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const image = ctx?.createImageData(width, height);
  if (image) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const across = Math.sin((x / (width - 1)) * Math.PI);
        const along = Math.sin((y / (height - 1)) * Math.PI);
        const alpha = Math.pow(across, 1.6) * Math.pow(along, 0.55);
        const i = (y * width + x) * 4;
        image.data[i + 3] = Math.round(alpha * 150);
      }
    }
    ctx?.putImageData(image, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function disc(x: number, z: number, radius: number): THREE.BufferGeometry {
  const geo = new THREE.CircleGeometry(radius, 14);
  geo.rotateX(-Math.PI / 2);
  geo.translate(x, 0.03, z);
  return geo;
}
