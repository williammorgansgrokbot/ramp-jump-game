import * as THREE from 'three';
import { GAP, LOOP, MEGA, QUARTER } from './stunts';

export interface Pbr {
  map: THREE.Texture;
  normal: THREE.Texture;
  rough: THREE.Texture;
}

export interface FieldArt {
  grassA: Pbr;
  grassB: Pbr;
  flowers: Pbr;
  dirt: Pbr;
  rutted: Pbr;
  sand: Pbr;
  asphalt: Pbr;
  curb: Pbr;
  planks: Pbr;
  concrete: Pbr;
  sprites: Map<string, THREE.Texture>;
}

const NAMES = ['grass_a', 'grass_b', 'grass_flowers', 'dirt', 'dirt_rutted', 'sand', 'asphalt', 'curb', 'ramp_planks', 'concrete'] as const;

const LANES = [0, LOOP.laneX, QUARTER.laneX, GAP.laneX, MEGA.laneX];

export async function loadFieldArt(base: string, hi: boolean, anisotropy: number): Promise<FieldArt | null> {
  const folder = `${base}art/field/${hi ? 'hi' : 'lo'}/`;
  const aniso = Math.min(16, Math.max(1, anisotropy));
  const loaded = await Promise.all(NAMES.map(async (name) => {
    const [map, normal, rough] = await Promise.all([
      loadMap(`${folder}${name}.webp`, aniso, 'srgb'),
      loadMap(`${folder}${name}_normal.webp`, aniso, 'data'),
      loadMap(`${folder}${name}_rough.webp`, aniso, 'data'),
    ]);
    return [name, map && normal && rough ? { map, normal, rough } : null] as const;
  }));
  const table = Object.fromEntries(loaded) as Record<(typeof NAMES)[number], Pbr | null>;
  if (NAMES.some((name) => !table[name])) return null;
  const sprites = new Map<string, THREE.Texture>();
  const spriteNames = [
    'tuft_grass_a', 'tuft_grass_b', 'tuft_buttercup', 'tuft_daisy', 'tuft_poppy', 'tuft_lavender',
    'rock_a', 'rock_b', 'rock_c', 'rock_d', 'hedge_a', 'hedge_b', 'hedge_c',
  ];
  await Promise.all(spriteNames.map(async (name) => {
    const tex = await loadMap(`${base}art/field/sprites/${name}.webp`, 4, 'srgb');
    if (tex) {
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      sprites.set(name, tex);
    }
  }));
  return {
    grassA: table.grass_a!,
    grassB: table.grass_b!,
    flowers: table.grass_flowers!,
    dirt: table.dirt!,
    rutted: table.dirt_rutted!,
    sand: table.sand!,
    asphalt: table.asphalt!,
    curb: table.curb!,
    planks: table.ramp_planks!,
    concrete: table.concrete!,
    sprites,
  };
}

function loadMap(url: string, anisotropy: number, space: 'srgb' | 'data'): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(url, (tex) => {
      tex.colorSpace = space === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = anisotropy;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      resolve(tex);
    }, undefined, () => resolve(null));
  });
}

/** Grass variants, flowers, rutted shoulders, and sand by the ponds. Grass normals are raised. */
export function dressGround(material: THREE.MeshStandardMaterial, art: FieldArt): void {
  material.map = art.grassA.map;
  material.normalMap = art.grassA.normal;
  material.normalScale.set(2.8, 2.8);
  material.roughnessMap = art.grassA.rough;
  material.roughness = 1;
  material.metalness = 0;
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms.grassBMap = { value: art.grassB.map };
    shader.uniforms.flowerMap = { value: art.flowers.map };
    shader.uniforms.grassBNormal = { value: art.grassB.normal };
    shader.uniforms.flowerNormal = { value: art.flowers.normal };
    shader.uniforms.ruttedMap = { value: art.rutted.map };
    shader.uniforms.ruttedNormal = { value: art.rutted.normal };
    shader.uniforms.ruttedRough = { value: art.rutted.rough };
    shader.uniforms.sandMap = { value: art.sand.map };
    shader.uniforms.sandNormal = { value: art.sand.normal };
    shader.uniforms.sandRough = { value: art.sand.rough };
    shader.uniforms.grassBRough = { value: art.grassB.rough };
    shader.fragmentShader = `uniform sampler2D grassBMap;\nuniform sampler2D flowerMap;\nuniform sampler2D grassBNormal;\nuniform sampler2D flowerNormal;\nuniform sampler2D ruttedMap;\nuniform sampler2D ruttedNormal;\nuniform sampler2D ruttedRough;\nuniform sampler2D sandMap;\nuniform sampler2D sandNormal;\nuniform sampler2D sandRough;\nuniform sampler2D grassBRough;\nfloat fieldPath;\nfloat fieldSand;\nfloat fieldFlower;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       float grassPatch = fract(sin(dot(floor(vGroundWorld.xz * 0.07), vec2(12.9898, 78.233))) * 43758.5453);
       fieldFlower = smoothstep(0.62, 0.86, grassPatch);
       vec3 grassB = texture2D(grassBMap, vMapUv).rgb;
       vec3 flowers = texture2D(flowerMap, vMapUv * 0.92).rgb;
       diffuseColor.rgb = mix(diffuseColor.rgb, grassB, smoothstep(0.28, 0.62, grassPatch));
       diffuseColor.rgb = mix(diffuseColor.rgb, flowers, fieldFlower);
       float lane = min(abs(vGroundWorld.x), min(abs(vGroundWorld.x - ${LOOP.laneX.toFixed(1)}), min(abs(vGroundWorld.x - ${QUARTER.laneX.toFixed(1)}), min(abs(vGroundWorld.x - ${GAP.laneX.toFixed(1)}), abs(vGroundWorld.x - ${MEGA.laneX.toFixed(1)})))));
       float along = smoothstep(-8.0, 2.0, vGroundWorld.z) * (1.0 - smoothstep(150.0, 175.0, vGroundWorld.z));
       fieldPath = (1.0 - smoothstep(7.2, 13.5, lane)) * along;
       vec3 rutted = texture2D(ruttedMap, vMapUv * 0.85).rgb;
       diffuseColor.rgb = mix(diffuseColor.rgb, rutted, fieldPath * 0.82);
       float pondA = length(vGroundWorld.xz - vec2(0.0, 88.0));
       float pondB = length(vGroundWorld.xz - vec2(${GAP.laneX.toFixed(1)}, 45.0));
       fieldSand = max(1.0 - smoothstep(7.0, 16.0, pondA), 1.0 - smoothstep(7.5, 18.0, pondB));
       diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(sandMap, vMapUv * 0.8).rgb, fieldSand);
       float macro = sin(vGroundWorld.x * 0.031 + 1.7) * sin(vGroundWorld.z * 0.023);
       float macroPatch = fract(sin(dot(floor(vGroundWorld.xz * 0.17), vec2(27.1, 91.7))) * 12543.2);
       float shade = clamp(0.5 + macro * 0.16 + (macroPatch - 0.5) * 0.14, 0.0, 1.0);
       diffuseColor.rgb *= mix(0.92, 1.06, shade);
       float farFade = smoothstep(150.0, 290.0, length(vGroundWorld.xz - vec2(40.0, 70.0)));
       diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.773, 0.867, 0.957), farFade);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#ifdef USE_NORMALMAP_TANGENTSPACE
        vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
        vec3 mapNB = texture2D( grassBNormal, vNormalMapUv ).xyz * 2.0 - 1.0;
        vec3 mapNF = texture2D( flowerNormal, vNormalMapUv * 0.92 ).xyz * 2.0 - 1.0;
        mapN = normalize(mix(mapN, mapNB, 0.45));
        mapN = normalize(mix(mapN, mapNF, fieldFlower));
        mapN.xy *= normalScale;
        vec3 pathN = texture2D( ruttedNormal, vNormalMapUv * 0.85 ).xyz * 2.0 - 1.0;
        vec3 sandN = texture2D( sandNormal, vNormalMapUv * 0.8 ).xyz * 2.0 - 1.0;
        mapN = normalize(mix(mapN, pathN, fieldPath * 0.82));
        mapN = normalize(mix(mapN, sandN, fieldSand));
        mapN.xy += vec2(sin(vGroundWorld.x * 0.031), sin(vGroundWorld.z * 0.023)) * 0.15;
        normal = normalize( tbn * mapN );
      #endif`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `float roughnessFactor = roughness;
       #ifdef USE_ROUGHNESSMAP
         float roughA = texture2D( roughnessMap, vRoughnessMapUv ).g;
         float roughB = texture2D( grassBRough, vRoughnessMapUv ).g;
         float roughP = texture2D( ruttedRough, vRoughnessMapUv * 0.85 ).g;
         float roughS = texture2D( sandRough, vRoughnessMapUv * 0.8 ).g;
         roughnessFactor *= mix(mix(roughA, roughB, 0.45), roughP, fieldPath * 0.82);
         roughnessFactor = mix(roughnessFactor, roughS, fieldSand);
       #endif`,
    );
  };
}

export type DeckRole = 'road' | 'ramp' | 'rutted' | 'concrete';

export function deckRole(id: string): DeckRole {
  if (id === 'gap-ramp') return 'ramp';
  if (id === 'mega-run') return 'concrete';
  if (id === 'landing' || id.endsWith('land')) return 'rutted';
  return 'road';
}

/** Asphalt, rutted dirt, concrete, or planks. Plank UVs are rotated so the boards follow the ramp. */
export function dressDeck(material: THREE.MeshStandardMaterial, art: FieldArt, role: DeckRole, laneX: number): void {
  const primary = role === 'rutted' ? art.rutted : role === 'concrete' ? art.concrete : art.asphalt;
  material.map = primary.map;
  material.normalMap = primary.normal;
  material.normalScale.set(role === 'rutted' ? 1.4 : 1, role === 'rutted' ? 1.4 : 1);
  material.roughnessMap = primary.rough;
  material.roughness = 1;
  material.metalness = role === 'road' || role === 'ramp' ? 0.04 : 0.02;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.plankMap = { value: art.planks.map };
    shader.uniforms.plankNormal = { value: art.planks.normal };
    shader.uniforms.plankRough = { value: art.planks.rough };
    shader.uniforms.curbMap = { value: art.curb.map };
    shader.uniforms.curbNormal = { value: art.curb.normal };
    shader.uniforms.curbRough = { value: art.curb.rough };
    shader.uniforms.deckRole = { value: role === 'ramp' ? 1 : role === 'concrete' ? 2 : 0 };
    shader.uniforms.laneX = { value: laneX };
    shader.vertexShader = `varying vec3 vDeckWorld;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
       vDeckWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );
    shader.fragmentShader = `varying vec3 vDeckWorld;\nuniform sampler2D plankMap;\nuniform sampler2D plankNormal;\nuniform sampler2D plankRough;\nuniform sampler2D curbMap;\nuniform sampler2D curbNormal;\nuniform sampler2D curbRough;\nuniform float deckRole;\nuniform float laneX;\nfloat deckPlank;\nfloat deckCurb;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       vec2 plankUv = vec2(vMapUv.y, vMapUv.x);
       float rampMix = deckRole > 0.5 && deckRole < 1.5 ? (abs(laneX) < 0.5 ? smoothstep(49.0, 52.5, vDeckWorld.z) : 1.0) : 0.0;
       deckPlank = rampMix;
       vec3 planks = texture2D(plankMap, plankUv).rgb;
       diffuseColor.rgb = mix(diffuseColor.rgb, planks, deckPlank);
       float edge = smoothstep(5.4, 7.6, abs(vDeckWorld.x - laneX));
       deckCurb = edge * max(step(0.5, deckRole), 1.0 - step(0.6, abs(laneX - ${LOOP.laneX.toFixed(1)})));
       diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(curbMap, vec2(vDeckWorld.z * 0.18, edge)).rgb, deckCurb);
       float deckGrain = fract(sin(dot(floor(vDeckWorld.xz * 0.35), vec2(19.4, 63.1))) * 21413.7);
       diffuseColor.rgb *= mix(0.94, 1.05, deckGrain);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#ifdef USE_NORMALMAP_TANGENTSPACE
        vec2 plankUvN = vec2(vNormalMapUv.y, vNormalMapUv.x);
        vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
        vec3 plankN = texture2D( plankNormal, plankUvN ).xyz * 2.0 - 1.0;
        vec3 curbN = texture2D( curbNormal, vec2(vDeckWorld.z * 0.18, 0.5) ).xyz * 2.0 - 1.0;
        mapN = normalize(mix(mapN, plankN, deckPlank));
        mapN.xy *= normalScale;
        mapN = normalize(mix(mapN, curbN, deckCurb));
        normal = normalize( tbn * mapN );
      #endif`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `float roughnessFactor = roughness;
       #ifdef USE_ROUGHNESSMAP
         float roughBase = texture2D( roughnessMap, vRoughnessMapUv ).g;
         float roughPlank = texture2D( plankRough, vec2(vRoughnessMapUv.y, vRoughnessMapUv.x) ).g;
         float roughCurb = texture2D( curbRough, vec2(vDeckWorld.z * 0.18, 0.5) ).g;
         roughnessFactor *= mix(roughBase, roughPlank, deckPlank);
         roughnessFactor = mix(roughnessFactor, roughCurb, deckCurb);
       #endif`,
    );
  };
}

export function scatterField(scene: THREE.Scene, art: FieldArt, level: 'high' | 'medium' | 'low'): void {
  const tuftScale = level === 'high' ? 1 : level === 'medium' ? 0.7 : 0.4;
  const tufts = Math.round(180 * tuftScale);
  const flowers = Math.round(90 * tuftScale);
  const rocks = Math.round(28 * tuftScale);
  placeBillboards(scene, [art.sprites.get('tuft_grass_a'), art.sprites.get('tuft_grass_b')], tufts, 0x71f00a, 0.55, 0.85, 10.4, 15.5);
  placeBillboards(scene, ['tuft_buttercup', 'tuft_daisy', 'tuft_poppy', 'tuft_lavender'].map((name) => art.sprites.get(name)), flowers, 0x71f0bb, 0.45, 0.75, 11, 16);
  placeBillboards(scene, ['rock_a', 'rock_b', 'rock_c', 'rock_d'].map((name) => art.sprites.get(name)), rocks, 0xc0ffee, 0.7, 1.35, 14, 22);
  placeHedges(scene, art, level);
}

function placeBillboards(scene: THREE.Scene, textures: Array<THREE.Texture | undefined>, count: number, seed: number, minH: number, maxH: number, near: number, far: number): void {
  const maps = textures.filter((tex): tex is THREE.Texture => !!tex);
  if (!maps.length || count < 1) return;
  const rand = mulberry32(seed);
  const spots: { x: number; z: number; h: number; kind: number }[] = [];
  let guard = 0;
  while (spots.length < count && guard < count * 30) {
    guard += 1;
    const lane = LANES[Math.floor(rand() * LANES.length)];
    const side = rand() < 0.5 ? -1 : 1;
    const x = lane + side * (near + rand() * (far - near));
    const z = -4 + rand() * 150;
    if (Math.abs(x - lane) < 9.5) continue;
    spots.push({ x, z, h: minH + rand() * (maxH - minH), kind: Math.floor(rand() * maps.length) });
  }
  maps.forEach((map, kind) => {
    const group = spots.filter((spot) => spot.kind === kind);
    if (!group.length) return;
    scene.add(billboards(map, group));
  });
}

function placeHedges(scene: THREE.Scene, art: FieldArt, level: 'high' | 'medium' | 'low'): void {
  const maps = ['hedge_a', 'hedge_b', 'hedge_c'].map((name) => art.sprites.get(name)).filter((tex): tex is THREE.Texture => !!tex);
  if (!maps.length) return;
  const lanes = level === 'low' ? [0] : level === 'medium' ? [0, LOOP.laneX, GAP.laneX] : LANES;
  const step = level === 'low' ? 3.1 : 1.9;
  const groups = maps.map(() => [] as { x: number; z: number; h: number }[]);
  lanes.forEach((lane, laneIndex) => {
    for (const side of [-1, 1]) {
      for (let z = 0; z < 78; z += step) {
        groups[laneIndex % maps.length].push({ x: lane + side * 12.2, z, h: 1.25 });
      }
    }
  });
  maps.forEach((map, index) => {
    const geo = new THREE.PlaneGeometry(3.7, 1.45);
    geo.translate(0, 0.72, 0);
    const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.4, roughness: 0.85, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, groups[index].length));
    const dummy = new THREE.Object3D();
    groups[index].forEach((hedge, i) => {
      dummy.position.set(hedge.x, GRASS, hedge.z);
      dummy.rotation.set(0, Math.PI / 2, 0);
      dummy.scale.set(1, hedge.h, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = groups[index].length;
    mesh.frustumCulled = false;
    scene.add(mesh);
  });
}

const GRASS = -0.55;

function billboards(map: THREE.Texture, spots: { x: number; z: number; h: number }[]): THREE.InstancedMesh {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.42, roughness: 0.86, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
      vec4 worldCenter = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float sx = length((instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
      float sy = length((instanceMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
      vec3 toCam = cameraPosition - worldCenter.xyz;
      toCam.y = 0.0;
      if (dot(toCam, toCam) < 1e-6) toCam = vec3(0.0, 0.0, 1.0);
      toCam = normalize(toCam);
      vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
      vec3 worldPos = worldCenter.xyz + right * position.x * sx + vec3(0.0, position.y * sy, 0.0);
      vec4 mvPosition = viewMatrix * vec4(worldPos, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      `,
    );
  };
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  const dummy = new THREE.Object3D();
  spots.forEach((spot, i) => {
    dummy.position.set(spot.x, GRASS, spot.z);
    dummy.scale.set(spot.h * 0.85, spot.h, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
