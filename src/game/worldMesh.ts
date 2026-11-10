import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { barrierBoxes, launchHeight, surfaceGrids, TRACK_HALF_WIDTH, type SurfaceGrid } from './terrain';
import { LOOP, QUARTER, GAP, MEGA } from './stunts';
import { buildStuntExtras } from './stuntMesh';
import { enabledLaunch } from './catalog';

/** Brightest cluster in the sea panorama (equirect, Three.js equirectUv). */
export const SUN_DIR = new THREE.Vector3(-0.22, 0.827, 0.517).normalize();
/** Average color of the panorama's horizon band, so fog matches the haze. */
export const HORIZON = new THREE.Color(154 / 255, 174 / 255, 183 / 255);
export const SKY_TINT = new THREE.Color(114 / 255, 154 / 255, 195 / 255);

export interface WorldOptions {
  hiPano: boolean;
  treeCount: number;
  tuftCount: number;
  anisotropy: number;
}

export interface WorldView {
  update(dt: number): void;
}

const TREE_KINDS = ['tree_birch', 'tree_bush', 'tree_cherry', 'tree_flowershrub', 'tree_maple', 'tree_oak', 'tree_palm', 'tree_pine'] as const;

interface TreeMeta {
  name: string;
  u: number;
  v: number;
  su: number;
  sv: number;
  aspect: number;
}

export async function buildWorld(scene: THREE.Scene, renderer: THREE.WebGLRenderer, opts: WorldOptions): Promise<WorldView> {
  const base = import.meta.env.BASE_URL;
  const aniso = Math.min(8, Number.isFinite(opts.anisotropy) ? opts.anisotropy : 4);
  const [pano, grass, sand, asphalt, dirt, wood, trees, treeMeta] = await Promise.all([
    loadTexture(`${base}art/${opts.hiPano ? 'pano_sea_4096x2048.webp' : 'pano_sea_2048x1024.webp'}`, aniso, false),
    loadTexture(`${base}art/textures/tex_grass.webp`, aniso, true),
    loadTexture(`${base}art/textures/tex_sand.webp`, aniso, true),
    loadTexture(`${base}art/textures/tex_asphalt.webp`, aniso, true),
    loadTexture(`${base}art/textures/tex_dirt.webp`, aniso, true),
    loadTexture(`${base}art/textures/tex_ramp_wood.webp`, aniso, true),
    loadTexture(`${base}art/trees.webp`, aniso, false),
    fetch(`${base}art/trees.json`).then((res) => (res.ok ? res.json() as Promise<TreeMeta[]> : [])).catch(() => [] as TreeMeta[]),
  ]);

  if (pano) {
    pano.mapping = THREE.EquirectangularReflectionMapping;
    pano.colorSpace = THREE.SRGBColorSpace;
    scene.background = pano;
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromEquirectangular(pano).texture;
      scene.environmentIntensity = 0.72;
      pmrem.dispose();
    } catch (err) {
      console.info('Environment map skipped', err);
    }
  }

  const [runway, landing] = surfaceGrids();
  scene.add(ground(grass, sand, dirt));
  scene.add(driveDeck(runway, asphalt, wood, dirt, 3.2, 0.9, 0.04, 'road'));
  scene.add(driveDeck(landing, dirt, sand, dirt, 3.6, 0.96, 0.02, 'dirt'));
  for (const grid of surfaceGrids()) {
    if (grid.id === 'runway-ramp' || grid.id === 'landing') continue;
    const dirtDeck = grid.id.endsWith('land');
    scene.add(driveDeck(grid, dirtDeck ? dirt : asphalt, sand, dirt, 3.4, dirtDeck ? 0.96 : 0.9, 0.03, dirtDeck ? 'dirt' : 'road'));
  }
  scene.add(dashes());
  scene.add(edgeLines());
  scene.add(chevrons());
  scene.add(barriers());
  scene.add(rampBuild(wood));
  scene.add(lipChecks());
  scene.add(edgeBulbs());
  scene.add(pond(sand));
  scene.add(quarterPipe(wood));
  const extras = buildStuntExtras(wood);
  scene.add(extras);
  if (opts.tuftCount > 0) scene.add(grassTufts(opts.tuftCount));
  if (trees && treeMeta.length > 0) {
    const sprites = scatterTrees(trees, treeMeta, opts.treeCount);
    scene.add(sprites.shadows, sprites.foliage);
  }

  return {
    update() {
      const bob = Math.sin(performance.now() / 160) * 0.05;
      extras.traverse((obj) => {
        if (obj.name === 'boost') obj.position.y = bob;
      });
    },
  };
}

function loadTexture(url: string, anisotropy: number, repeat: boolean): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = anisotropy;
        tex.wrapS = tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        resolve(tex);
      },
      undefined,
      () => {
        console.info('Texture skipped', url);
        resolve(null);
      },
    );
  });
}

const GRASS_Y = -0.55;
const SKIRT = 0.62;

function blankTex(): THREE.Texture {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ground(grass: THREE.Texture | null, sand: THREE.Texture | null, dirt: THREE.Texture | null): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(560, 560, 48, 48);
  geo.rotateX(-Math.PI / 2);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 4.5, pos.getZ(i) / 4.5);
  const material = new THREE.MeshStandardMaterial({
    map: grass ?? undefined,
    color: grass ? 0xffffff : 0x3f9a45,
    roughness: 0.96,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.sandMap = { value: sand ?? blankTex() };
    shader.uniforms.dirtMap = { value: dirt ?? blankTex() };
    shader.vertexShader = `varying vec3 vGroundWorld;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       float lane = min(abs(transformed.x), min(abs(transformed.x - ${LOOP.laneX.toFixed(1)}), min(abs(transformed.x - ${QUARTER.laneX.toFixed(1)}), min(abs(transformed.x - ${GAP.laneX.toFixed(1)}), abs(transformed.x - ${MEGA.laneX.toFixed(1)})))));
       float side = smoothstep(12.0, 28.0, lane);
       float ahead = smoothstep(175.0, 250.0, transformed.z);
       float back = smoothstep(-16.0, -80.0, transformed.z);
       float wave = sin(transformed.x * 0.042) * sin(transformed.z * 0.027);
       transformed.y += (side * 0.9 + ahead * 0.55 + back * 0.35) * (1.45 * wave + 0.4 * sin(transformed.z * 0.018));`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
       vGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );
    shader.fragmentShader = `varying vec3 vGroundWorld;\nuniform sampler2D sandMap;\nuniform sampler2D dirtMap;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       vec3 sandCol = texture2D(sandMap, vMapUv * 0.85).rgb;
       vec3 dirtCol = texture2D(dirtMap, vMapUv * 1.15).rgb;
       float dist = length(vGroundWorld.xz - vec2(0.0, 70.0));
       float sandMix = smoothstep(48.0, 140.0, dist);
       float shoulder = (1.0 - smoothstep(9.2, 17.0, abs(vGroundWorld.x))) * smoothstep(-6.0, 4.0, vGroundWorld.z) * (1.0 - smoothstep(162.0, 184.0, vGroundWorld.z));
       diffuseColor.rgb = mix(diffuseColor.rgb, dirtCol, shoulder * 0.8);
       diffuseColor.rgb = mix(diffuseColor.rgb, sandCol, sandMix * (1.0 - shoulder));
       float macro = 0.5 + 0.5 * sin(vMapUv.x * 1.7) * sin(vMapUv.y * 1.3);
       diffuseColor.rgb *= mix(0.88, 1.08, macro);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
       float luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
       normal = normalize(normal - vec3(dFdx(luma), dFdy(luma), 0.0) * 1.5);`,
    );
  };
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = GRASS_Y;
  mesh.receiveShadow = true;
  return mesh;
}

function gridSamples(grid: SurfaceGrid): { z: number; y: number }[] {
  const steps = grid.samples - 1;
  const out: { z: number; y: number }[] = [];
  for (let i = 0; i < grid.samples; i++) {
    out.push({ z: grid.z0 + (i / steps) * (grid.z1 - grid.z0), y: grid.heights[i] });
  }
  return out;
}

function driveDeck(
  grid: SurfaceGrid,
  map: THREE.Texture | null,
  blend: THREE.Texture | null,
  dirt: THREE.Texture | null,
  tile: number,
  roughness: number,
  metalness: number,
  mode: 'road' | 'dirt',
): THREE.Group {
  const samples = gridSamples(grid);
  const nx = 8;
  const steps = samples.length - 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const row = nx + 1;
  for (let iz = 0; iz < samples.length; iz++) {
    const { z, y } = samples[iz];
    for (let ix = 0; ix <= nx; ix++) {
      const x = grid.x - grid.half + (2 * grid.half * ix) / nx;
      positions.push(x, y, z);
      uvs.push(x / tile, z / tile);
    }
  }
  for (let iz = 0; iz < steps; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const a = iz * row + ix;
      indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    map: map ?? undefined,
    color: map ? 0xffffff : mode === 'road' ? 0x3a4150 : 0xc4a574,
    roughness,
    metalness,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.blendMap = { value: blend ?? blankTex() };
    shader.uniforms.dirtMap = { value: dirt ?? blankTex() };
    shader.uniforms.laneX = { value: grid.x };
    shader.vertexShader = `varying vec3 vDeckWorld;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
       vDeckWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );
    shader.fragmentShader = `varying vec3 vDeckWorld;\nuniform sampler2D blendMap;\nuniform sampler2D dirtMap;\nuniform float laneX;\n${shader.fragmentShader}`;
    const mixBlock = mode === 'road'
      ? `float rampMix = step(abs(laneX), 0.5) * smoothstep(49.0, 52.5, vDeckWorld.z);
         diffuseColor.rgb = mix(diffuseColor.rgb, blendCol, rampMix);
         diffuseColor.rgb = mix(diffuseColor.rgb, dirtCol, edge * (1.0 - rampMix));
         float wear = smoothstep(0.55, 0.92, fract(sin(dot(vDeckWorld.xz, vec2(12.9898, 78.233))) * 43758.5453));
         diffuseColor.rgb *= mix(1.0, 0.84, wear * (1.0 - rampMix) * 0.65);`
      : `diffuseColor.rgb = mix(diffuseColor.rgb, blendCol, edge * 0.28);`;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       vec3 blendCol = texture2D(blendMap, vMapUv).rgb;
       vec3 dirtCol = texture2D(dirtMap, vMapUv * 0.8).rgb;
       float edge = smoothstep(5.2, 8.6, abs(vDeckWorld.x - laneX));
       float macro = 0.5 + 0.5 * sin(vDeckWorld.x * 0.41) * sin(vDeckWorld.z * 0.23);
       diffuseColor.rgb *= mix(0.9, 1.06, macro);
       ${mixBlock}`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
       float luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
       normal = normalize(normal - vec3(dFdx(luma), dFdy(luma), 0.0) * 2.0);`,
    );
  };
  const top = new THREE.Mesh(geo, material);
  top.receiveShadow = true;

  const skirtPos: number[] = [];
  const skirtUv: number[] = [];
  const skirtIdx: number[] = [];
  const pushEdge = (x: number) => {
    const base = skirtPos.length / 3;
    for (let iz = 0; iz < samples.length; iz++) {
      const { z, y } = samples[iz];
      skirtPos.push(x, y, z, x, y - SKIRT, z);
      skirtUv.push(z / tile, 0, z / tile, 1);
    }
    for (let iz = 0; iz < steps; iz++) {
      const a = base + iz * 2;
      skirtIdx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  };
  pushEdge(grid.x - grid.half);
  pushEdge(grid.x + grid.half);
  const skirtGeo = new THREE.BufferGeometry();
  skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(skirtPos, 3));
  skirtGeo.setAttribute('uv', new THREE.Float32BufferAttribute(skirtUv, 2));
  skirtGeo.setIndex(skirtIdx);
  skirtGeo.computeVertexNormals();
  const skirtMat = new THREE.MeshStandardMaterial({
    color: mode === 'road' ? 0x6b5340 : 0x8a704c,
    roughness: 0.94,
    metalness: 0.02,
  });
  const skirt = new THREE.Mesh(skirtGeo, skirtMat);
  skirt.receiveShadow = true;
  const group = new THREE.Group();
  group.add(top, skirt);
  return group;
}

function scatterTrees(atlas: THREE.Texture | null, meta: TreeMeta[], count: number): { foliage: THREE.InstancedMesh; shadows: THREE.InstancedMesh } {
  if (!atlas) return { foliage: new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial(), 1), shadows: new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial(), 1) };
  const rand = mulberry32(0x5eed);
  const placed: { x: number; z: number; h: number; kind: number }[] = [];
  let guard = 0;
  while (placed.length < count && guard < count * 40) {
    guard += 1;
    const x = (rand() * 2 - 1) * 190;
    const z = -12 + rand() * 210;
    if (Math.abs(x) < 13.5 && z > -6 && z < 188) continue;
    if (Math.abs(x) < 16 && z > 46 && z < 92) continue;
    const lanes = [LOOP.laneX, QUARTER.laneX, GAP.laneX, MEGA.laneX];
    if (lanes.some((lane) => Math.abs(x - lane) < 12 && z > -8 && z < 160)) continue;
    const kind = Math.floor(rand() * TREE_KINDS.length);
    const tall = 3.8 + rand() * 6.2;
    const boost = TREE_KINDS[kind] === 'tree_palm' || TREE_KINDS[kind] === 'tree_pine' ? 1.25 : 1;
    placed.push({ x, z, h: tall * boost, kind });
  }

  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0);
  const treeUv = new Float32Array(placed.length * 4);
  const color = new Float32Array(placed.length * 3);
  placed.forEach((tree, i) => {
    const info = meta[tree.kind] ?? meta[0];
    treeUv[i * 4] = info.u;
    treeUv[i * 4 + 1] = info.v;
    treeUv[i * 4 + 2] = info.su;
    treeUv[i * 4 + 3] = info.sv;
    const fringe = info.name === 'tree_pine' || info.name === 'tree_maple';
    color[i * 3] = fringe ? 1.04 : 1;
    color[i * 3 + 1] = fringe ? 1.08 : 1;
    color[i * 3 + 2] = fringe ? 0.94 : 1;
  });
  geo.setAttribute('treeUv', new THREE.InstancedBufferAttribute(treeUv, 4));

  const material = new THREE.MeshBasicMaterial({
    map: atlas,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
  material.customProgramCacheKey = () => 'tree-billboard';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute vec4 treeUv;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
       #ifdef USE_MAP
         vMapUv = uv * treeUv.zw + treeUv.xy;
       #endif`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
      vec4 mvPosition;
      vec4 worldCenter = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float sx = length((instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
      float sy = length((instanceMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
      vec3 toCam = cameraPosition - worldCenter.xyz;
      toCam.y = 0.0;
      if (dot(toCam, toCam) < 1e-6) toCam = vec3(0.0, 0.0, 1.0);
      toCam = normalize(toCam);
      vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
      vec3 worldPos = worldCenter.xyz + right * position.x * sx + vec3(0.0, position.y * sy, 0.0);
      mvPosition = viewMatrix * vec4(worldPos, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       float edge = smoothstep(0.85, 0.5, sampledDiffuseColor.a);
       sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, sampledDiffuseColor.rgb * vec3(1.12, 1.2, 0.92) + vec3(0.05, 0.08, 0.02), edge);`,
    );
  };

  const foliage = new THREE.InstancedMesh(geo, material, placed.length);
  foliage.instanceColor = new THREE.InstancedBufferAttribute(color, 3);
  foliage.frustumCulled = false;
  foliage.castShadow = false;
  foliage.receiveShadow = false;

  const shadowGeo = new THREE.PlaneGeometry(1, 1);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: blobTexture(),
    transparent: true,
    depthWrite: false,
    toneMapped: true,
    opacity: 0.45,
  });
  const shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, placed.length);
  shadows.frustumCulled = false;
  shadows.renderOrder = 1;

  const dummy = new THREE.Object3D();
  placed.forEach((tree, i) => {
    dummy.position.set(tree.x, 0, tree.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(tree.h, tree.h, 1);
    dummy.updateMatrix();
    foliage.setMatrixAt(i, dummy.matrix);
    dummy.position.y = 0.03;
    dummy.scale.set(tree.h * 0.62, tree.h * 0.42, 1);
    dummy.updateMatrix();
    shadows.setMatrixAt(i, dummy.matrix);
  });
  foliage.instanceMatrix.needsUpdate = true;
  shadows.instanceMatrix.needsUpdate = true;
  return { foliage, shadows };
}

function blobTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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

function decalMat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.5,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

function edgeLines(): THREE.Mesh {
  const geos: THREE.BufferGeometry[] = [];
  for (const x of [-7.15, 7.15]) {
    const line = new THREE.BoxGeometry(0.14, 0.02, 46);
    line.translate(x, 0.02, 24);
    geos.push(line);
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos) ?? new THREE.BufferGeometry(), decalMat(0xf7f4ec));
  mesh.receiveShadow = true;
  return mesh;
}

function rampBuild(wood: THREE.Texture | null): THREE.Group {
  const group = new THREE.Group();
  const timber = new THREE.MeshStandardMaterial({ map: wood ?? undefined, color: wood ? 0xffffff : 0x8a5a2b, roughness: 0.84 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xc5ced6, metalness: 0.82, roughness: 0.28 });
  const boltMat = new THREE.MeshStandardMaterial({ color: 0x2a2e33, metalness: 0.6, roughness: 0.4 });
  const launch = enabledLaunch();
  for (let z = launch.z + 3; z < launch.z + launch.length - 1; z += 3.2) {
    const h = launchHeight(z);
    if (h < 1.2) continue;
    const postH = h - 0.55;
    for (const x of [-6.4, 6.4]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, postH, 0.28), timber);
      post.position.set(x, postH * 0.5 - 0.1, z);
      post.castShadow = true;
      group.add(post);
    }
    const brace = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.14, 0.14), metal);
    brace.position.set(0, Math.min(h - 0.75, Math.max(0.4, h * 0.4)), z);
    brace.castShadow = true;
    group.add(brace);
    for (const x of [-8.05, 8.05]) {
      const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), boltMat);
      bolt.position.set(x, h + 0.95, z);
      group.add(bolt);
    }
  }
  return group;
}

function pond(sand: THREE.Texture | null): THREE.Group {
  const group = new THREE.Group();
  const shore = new THREE.Mesh(
    new THREE.CircleGeometry(9.2, 28),
    new THREE.MeshStandardMaterial({ map: sand ?? undefined, color: sand ? 0xffffff : 0xd8c39a, roughness: 0.95 }),
  );
  shore.rotation.x = -Math.PI / 2;
  shore.position.set(0, -0.48, 88);
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(7.2, 28),
    new THREE.MeshStandardMaterial({ color: 0x3aa4c8, roughness: 0.12, metalness: 0.18, transparent: true, opacity: 0.88 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.42, 88);
  group.add(shore, water);
  return group;
}

function quarterPipe(wood: THREE.Texture | null): THREE.Group {
  const group = new THREE.Group();
  const deck = new THREE.MeshStandardMaterial({ map: wood ?? undefined, color: wood ? 0xfff2e4 : 0xc46a1a, roughness: 0.72 });
  const rail = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.45 });
  const radius = 6;
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    const y = Math.sin(a) * radius;
    const z = 124 + Math.cos(a) * radius;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.28, 0.95), deck);
    slab.position.set(20, y, z);
    slab.rotation.x = -a;
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);
    for (const side of [-1.7, 1.7]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.95), rail);
      bar.position.set(20 + side, y + 0.28, z);
      bar.rotation.x = -a;
      group.add(bar);
    }
  }
  return group;
}

function tuftTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return blankTex();
  ctx.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 8; i++) {
    ctx.strokeStyle = i % 2 === 0 ? '#2f8a34' : '#b6e36a';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(28 + i * 8, 122);
    ctx.quadraticCurveTo(22 + i * 10, 70, 18 + i * 11, 28 + (i % 3) * 10);
    ctx.stroke();
  }
  ctx.fillStyle = '#ff6b9a';
  ctx.beginPath();
  ctx.arc(100, 40, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffe14a';
  ctx.beginPath();
  ctx.arc(100, 40, 4.5, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function grassTufts(count: number): THREE.InstancedMesh {
  const geo = new THREE.PlaneGeometry(0.55, 0.85);
  const mat = new THREE.MeshStandardMaterial({
    map: tuftTexture(),
    alphaTest: 0.35,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const rand = mulberry32(0xc0ffee);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < count * 20) {
    guard += 1;
    const side = rand() < 0.5 ? -1 : 1;
    const x = side * (10.4 + rand() * 4.2);
    const z = -4 + rand() * 176;
    if (Math.abs(x) < 10) continue;
    const h = 0.45 + rand() * 0.55;
    dummy.position.set(x, GRASS_Y + h * 0.5, z);
    dummy.rotation.set(0, rand() * Math.PI, 0);
    dummy.scale.set(0.8 + rand() * 0.7, h / 0.85, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    const tint = rand();
    if (tint > 0.82) color.setHex(0xffd0e0);
    else if (tint > 0.68) color.setHex(0xfff3a1);
    else color.set(0.85 + rand() * 0.15, 1, 0.85 + rand() * 0.1);
    mesh.setColorAt(placed, color);
    placed += 1;
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  return mesh;
}

function dashes(): THREE.Mesh {
  const geos: THREE.BufferGeometry[] = [];
  for (let z = 2; z < 48; z += 4) {
    const dash = new THREE.BoxGeometry(0.28, 0.025, 1.5);
    dash.translate(0, 0.03, z);
    geos.push(dash);
  }
  const merged = mergeGeometries(geos);
  const mesh = new THREE.Mesh(merged ?? new THREE.BufferGeometry(), decalMat(0xf4f1ea));
  mesh.receiveShadow = true;
  return mesh;
}

function chevrons(): THREE.Mesh {
  const geos: THREE.BufferGeometry[] = [];
  const launch = enabledLaunch();
  for (let z = launch.z + 2; z < launch.z + launch.length - 1; z += 4) {
    const y = launchHeight(z) + 0.04;
    for (const side of [-1, 1]) {
      const chev = new THREE.BoxGeometry(1.1, 0.03, 0.28);
      chev.rotateY(side * 0.5);
      chev.translate(side * 0.7, y, z);
      geos.push(chev);
    }
  }
  const merged = mergeGeometries(geos);
  return new THREE.Mesh(merged ?? new THREE.BufferGeometry(), decalMat(0xfff3a1));
}

function barriers(): THREE.Group {
  const group = new THREE.Group();
  for (const box of barrierBoxes()) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(box.half.x * 2, box.half.y * 2, box.half.z * 2),
      new THREE.MeshStandardMaterial({ color: box.color, roughness: 0.55, metalness: 0.04 }),
    );
    mesh.position.set(box.center.x, box.center.y, box.center.z);
    mesh.rotation.x = box.rotX;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function lipChecks(): THREE.Mesh {
  const light: THREE.BufferGeometry[] = [];
  const darks: THREE.BufferGeometry[] = [];
  const z = 74;
  const y = launchHeight(z) + 0.05;
  for (let i = -7; i <= 7; i++) {
    const tile = new THREE.BoxGeometry(0.7, 0.04, 0.7);
    tile.translate(i * 0.72, y, z);
    (Math.abs(i) % 2 === 0 ? light : darks).push(tile);
  }
  const mesh = new THREE.Mesh(
    mergeGeometries(light) ?? new THREE.BufferGeometry(),
    decalMat(0xf2f2f2),
  );
  mesh.add(new THREE.Mesh(mergeGeometries(darks) ?? new THREE.BufferGeometry(), decalMat(0x1c1c1e)));
  return mesh;
}

function edgeBulbs(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xfff4cf, emissive: 0xffc14a, emissiveIntensity: 0.6, roughness: 0.4 });
  const launch = enabledLaunch();
  for (let z = launch.z; z <= launch.z + launch.length; z += 4) {
    const y = launchHeight(Math.min(z, launch.z + launch.length)) + 0.25;
    for (const x of [-7.6, 7.6]) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), mat);
      bulb.position.set(x, y, z);
      group.add(bulb);
    }
  }
  return group;
}
