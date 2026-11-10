import * as THREE from 'three';
import { BOOSTS, GAP, LOOP, loopRibbon, quarterRibbon } from './stunts';

/** Loop, quarter-pipe, pond, and glowing boost arrows. Colliders live in the physics world. */
export function buildStuntExtras(wood: THREE.Texture | null): THREE.Group {
  const group = new THREE.Group();
  group.add(ribbonMesh(loopRibbon(), 0xff5a1f, 0.22));
  group.add(ribbonRails(loopRibbon()));
  group.add(loopSupports());
  group.add(ribbonMesh(quarterRibbon(), 0xf0a202, 0.12));
  group.add(ribbonRails(quarterRibbon()));
  group.add(gapPond());
  for (const pad of BOOSTS) group.add(boostPad(pad.x, pad.z, pad.length));
  void wood;
  return group;
}

function ribbonMesh(ribbon: { vertices: Float32Array; indices: Uint32Array }, color: number, emissive: number): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(ribbon.vertices.slice(), 3));
  geo.setIndex(new THREE.BufferAttribute(ribbon.indices.slice(), 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.45,
      metalness: 0.08,
      emissive: color,
      emissiveIntensity: emissive,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

function ribbonRails(ribbon: { vertices: Float32Array }): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xf7f4ec, roughness: 0.4, metalness: 0.15 });
  const pos = ribbon.vertices;
  const row = 7;
  const steps = pos.length / 3 / row - 1;
  for (const edge of [0, row - 1]) {
    const geos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < steps; i += 2) {
      const a = (i * row + edge) * 3;
      const b = ((i + 1) * row + edge) * 3;
      const mid = new THREE.Vector3(pos[a], pos[a + 1], pos[a + 2]).lerp(new THREE.Vector3(pos[b], pos[b + 1], pos[b + 2]), 0.5);
      const len = Math.hypot(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]);
      const box = new THREE.BoxGeometry(0.14, 0.28, Math.max(0.2, len));
      box.translate(mid.x, mid.y + 0.25, mid.z);
      geos.push(box);
    }
    if (geos.length) {
      const merged = merge(geos);
      if (merged) group.add(new THREE.Mesh(merged, mat));
    }
  }
  return group;
}

function loopSupports(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xd7dde4, metalness: 0.65, roughness: 0.32 });
  const { radius: r, zCenter, laneX } = LOOP;
  for (let i = 2; i <= 8; i++) {
    const theta = (i / 10) * (Math.PI + 0.6);
    const y = r * (1 - Math.cos(theta));
    const z = zCenter + r * Math.sin(theta);
    if (y < 1.2) continue;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, y, 0.22), mat);
    post.position.set(laneX, y * 0.5, z);
    post.castShadow = true;
    group.add(post);
  }
  return group;
}

function gapPond(): THREE.Group {
  const group = new THREE.Group();
  const shore = new THREE.Mesh(
    new THREE.CircleGeometry(8, 24),
    new THREE.MeshStandardMaterial({ color: 0xe4d2a8, roughness: 0.95 }),
  );
  shore.rotation.x = -Math.PI / 2;
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(6.2, 24),
    new THREE.MeshStandardMaterial({ color: 0x3aa4c8, roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.9 }),
  );
  water.rotation.x = -Math.PI / 2;
  const z = (GAP.rampZ1 + GAP.landZ0) / 2;
  shore.position.set(GAP.laneX, -0.42, z);
  water.position.set(GAP.laneX, -0.36, z);
  group.add(shore, water);
  return group;
}

function boostPad(x: number, z: number, length: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'boost';
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffe14a,
    emissive: 0xffb703,
    emissiveIntensity: 0.9,
    roughness: 0.35,
  });
  for (let i = 0; i < 3; i++) {
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 3), mat);
    arrow.rotation.x = Math.PI / 2;
    arrow.position.set(x, 0.08, z - length * 0.3 + i * (length * 0.28));
    group.add(arrow);
  }
  group.userData.baseY = 0.08;
  return group;
}

function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  // Local merge so this file does not need the utils import for a handful of boxes.
  let count = 0;
  for (const geo of geos) count += geo.attributes.position.count;
  const positions = new Float32Array(count * 3);
  let offset = 0;
  for (const geo of geos) {
    const src = geo.attributes.position.array as Float32Array;
    positions.set(src, offset);
    offset += src.length;
    geo.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.computeVertexNormals();
  return merged;
}
