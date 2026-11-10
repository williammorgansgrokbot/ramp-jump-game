import * as THREE from 'three';
import type { FieldArt } from './fieldArt';
import { BOOSTS, GAP, LOOP, loopRibbon, quarterRibbon } from './stunts';
import { FIELD } from './terrain';

/** Loop, quarter-pipe, pond, and glowing boost arrows. Colliders live in the physics world. */
export function buildStuntExtras(wood: THREE.Texture | null, art: FieldArt | null = null): THREE.Group {
  const group = new THREE.Group();
  group.add(ribbonMesh(loopRibbon(), 0xff5a1f, 0.22, art));
  group.add(ribbonRails(loopRibbon()));
  group.add(loopSupports());
  group.add(ribbonMesh(quarterRibbon(), 0xf0a202, 0.12, art));
  group.add(ribbonRails(quarterRibbon()));
  group.add(gapPond());
  for (const pad of BOOSTS) group.add(boostPad(pad.x, pad.z, pad.length));
  void wood;
  return group;
}

function ribbonMesh(ribbon: { vertices: Float32Array; indices: Uint32Array }, color: number, emissive: number, art: FieldArt | null): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  const positions = ribbon.vertices.slice();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(ribbon.indices.slice(), 1));
  const row = 7;
  const count = positions.length / 3;
  const rings = count / row;
  const uvs = new Float32Array(count * 2);
  const normals = new Float32Array(count * 3);
  const at = (along: number, across: number) => {
    const aa = Math.max(0, Math.min(rings - 1, along));
    const kk = Math.max(0, Math.min(row - 1, across));
    const o = (aa * row + kk) * 3;
    return new THREE.Vector3(positions[o], positions[o + 1], positions[o + 2]);
  };
  for (let i = 0; i < count; i++) {
    const along = Math.floor(i / row);
    const across = i % row;
    // Plank seams in the texture are constant V. V runs along the ribbon
    // so the boards cross the road instead of striping down the middle.
    uvs[i * 2] = across / (row - 1);
    uvs[i * 2 + 1] = along * 0.28;
    const du = at(along, across + 1).sub(at(along, across - 1));
    const dv = at(along + 1, across).sub(at(along - 1, across));
    const normal = dv.cross(du);
    if (normal.lengthSq() < 1e-8) normal.set(0, 1, 0);
    else normal.normalize();
    normals[i * 3] = normal.x;
    normals[i * 3 + 1] = normal.y;
    normals[i * 3 + 2] = normal.z;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  const material = new THREE.MeshStandardMaterial({
    color: art ? 0xffffff : color,
    map: art?.planks.map,
    normalMap: art?.planks.normal,
    roughnessMap: art?.planks.rough,
    roughness: art ? 1 : 0.45,
    metalness: 0.06,
    emissive: color,
    emissiveIntensity: art ? 0.04 : emissive,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  if (art) {
    material.normalScale.set(1, 1);
    material.onBeforeCompile = (shader) => {
      shader.uniforms.curbMap = { value: art.curb.map };
      shader.uniforms.curbNormal = { value: art.curb.normal };
      shader.fragmentShader = `uniform sampler2D curbMap;\nuniform sampler2D curbNormal;\n${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         float curb = smoothstep(0.16, 0.0, vMapUv.x) + smoothstep(0.84, 1.0, vMapUv.x);
         diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(curbMap, vec2(vMapUv.y, 0.5)).rgb, clamp(curb, 0.0, 1.0));`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#ifdef USE_NORMALMAP_TANGENTSPACE
          vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
          mapN.xy *= normalScale;
          float curbEdge = smoothstep(0.16, 0.0, vNormalMapUv.x) + smoothstep(0.84, 1.0, vNormalMapUv.x);
          vec3 curbN = texture2D( curbNormal, vec2(vNormalMapUv.y, 0.5) ).xyz * 2.0 - 1.0;
          mapN = normalize(mix(mapN, curbN, clamp(curbEdge, 0.0, 1.0)));
          normal = normalize( tbn * mapN );
        #endif`,
      );
    };
  }
  const mesh = new THREE.Mesh(geo, material);
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
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, y, 0.18), mat);
      post.position.set(laneX + side * (LOOP.halfW + 0.2), y * 0.5, z);
      post.castShadow = true;
      group.add(post);
    }
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
