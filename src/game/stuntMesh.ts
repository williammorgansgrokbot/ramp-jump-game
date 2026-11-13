import * as THREE from 'three';
import type { FieldArt } from './fieldArt';
import { buildStuntShow } from './stuntShow';
import { BOOSTS, GAP } from './stunts';
import { FIELD } from './terrain';
import type { PolishArt } from './polishArt';

/** Stunt structures, the gap pond, and glowing boost arrows. Colliders live in the physics world. */
export async function buildStuntExtras(
  wood: THREE.Texture | null,
  art: FieldArt | null = null,
  opts: { base: string; mobile: boolean } = { base: '/', mobile: true },
  polish: Pick<PolishArt, 'water' | 'boost'> | null = null,
): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.add(await buildStuntShow(opts));
  group.add(gapPond(polish?.water ?? null));
  for (const pad of BOOSTS) group.add(boostPad(pad.x, pad.z, pad.length, polish?.boost ?? null));
  void wood;
  void art;
  return group;
}

function gapPond(water: THREE.Texture | null): THREE.Group {
  const group = new THREE.Group();
  const shore = new THREE.Mesh(
    new THREE.CircleGeometry(8, 24),
    new THREE.MeshStandardMaterial({ color: 0xe4d2a8, roughness: 0.95 }),
  );
  shore.rotation.x = -Math.PI / 2;
  const waterMat = water
    ? new THREE.MeshStandardMaterial({ map: water, roughness: 0.35, metalness: 0.02 })
    : new THREE.MeshStandardMaterial({ color: 0x3aa4c8, roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.9 });
  const surface = new THREE.Mesh(new THREE.CircleGeometry(6.2, 24), waterMat);
  surface.rotation.x = -Math.PI / 2;
  const z = (GAP.rampZ1 + GAP.landZ0) / 2;
  shore.position.set(GAP.laneX, FIELD.floorY + 0.04, z);
  surface.position.set(GAP.laneX, FIELD.floorY + 0.1, z);
  group.add(shore, surface);
  return group;
}

function boostPad(x: number, z: number, length: number, art: THREE.Texture | null): THREE.Group {
  const group = new THREE.Group();
  group.name = 'boost-mark';
  if (!art) {
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
  const geo = new THREE.PlaneGeometry(2.15, length);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    map: art,
    roughness: 0.85,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const decal = new THREE.Mesh(geo, mat);
  decal.position.set(x, 0.055, z);
  decal.receiveShadow = true;
  group.add(decal);
  return group;
}
