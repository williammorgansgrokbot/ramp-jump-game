import * as THREE from 'three';
import type { FieldArt } from './fieldArt';
import { buildStuntShow } from './stuntShow';
import { BOOSTS, GAP } from './stunts';
import { FIELD } from './terrain';

/** Stunt structures, the gap pond, and glowing boost arrows. Colliders live in the physics world. */
export async function buildStuntExtras(
  wood: THREE.Texture | null,
  art: FieldArt | null = null,
  opts: { base: string; mobile: boolean } = { base: '/', mobile: true },
): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.add(await buildStuntShow(opts));
  group.add(gapPond());
  for (const pad of BOOSTS) group.add(boostPad(pad.x, pad.z, pad.length));
  void wood;
  void art;
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
  shore.position.set(GAP.laneX, FIELD.floorY + 0.04, z);
  water.position.set(GAP.laneX, FIELD.floorY + 0.1, z);
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
