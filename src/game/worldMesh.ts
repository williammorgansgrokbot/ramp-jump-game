import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { barrierBoxes, LANDING, launchHeight, landingHeight, TRACK_HALF_WIDTH } from './terrain';
import { enabledLaunch } from './catalog';

/** Brightest cluster in the sea panorama (equirect, Three.js equirectUv). */
export const SUN_DIR = new THREE.Vector3(-0.22, 0.827, 0.517).normalize();
/** Average color of the panorama's horizon band, so fog matches the haze. */
export const HORIZON = new THREE.Color(154 / 255, 174 / 255, 183 / 255);
export const SKY_TINT = new THREE.Color(114 / 255, 154 / 255, 195 / 255);

export interface WorldOptions {
  hiPano: boolean;
  treeCount: number;
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
  const aniso = Math.min(8, opts.anisotropy);
  const [pano, grass, sand, asphalt, dirt, wood, trees, treeMeta] = await Promise.all([
    loadTexture(`${base}art/${opts.hiPano ? 'pano_sea_4096x2048.webp' : 'pano_sea_2048x1024.webp'}`, aniso, false),
    loadTexture(`${base}art/textures/tex_grass.webp`, aniso, true),
    loadTexture(`${base}art/textures/tex_sand.webp`, aniso, true),
    loadTexture(`${base}art/textures/tex_asphalt.webp`, aniso, true),
    loadTexture(`${base}art/textures/tex_dirt.webp`, aniso, true),
    loadTexture(`${base}art/textures/tex_ramp_wood.webp`, aniso, true),
    loadTexture(`${base}art/trees.webp`, aniso, false),
    fetch(`${base}art/trees.json`).then((res) => {
      if (!res.ok) throw new Error('trees.json missing');
      return res.json() as Promise<TreeMeta[]>;
    }),
  ]);

  pano.mapping = THREE.EquirectangularReflectionMapping;
  pano.colorSpace = THREE.SRGBColorSpace;
  scene.background = pano;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(pano).texture;
  scene.environmentIntensity = 0.72;
  pmrem.dispose();

  scene.add(ground(grass, sand));
  scene.add(texturedSurface(-4, 50, 28, () => 0, asphalt, 3.2, 0.94, 0.02));
  scene.add(texturedSurface(50, 78, 36, (z) => (z >= 74 ? launchHeight(74) : launchHeight(z)), wood, 2.4, 0.72, 0.08));
  scene.add(texturedSurface(LANDING.z0, LANDING.z1, 48, landingHeight, dirt, 3.6, 0.96, 0.02));
  scene.add(dashes());
  scene.add(chevrons());
  scene.add(barriers());
  scene.add(lipChecks());
  scene.add(edgeBulbs());
  const sprites = scatterTrees(trees, treeMeta, opts.treeCount);
  scene.add(sprites.shadows, sprites.foliage);

  return { update() {} };
}

function loadTexture(url: string, anisotropy: number, repeat: boolean): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
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
      () => reject(new Error(`Failed to load ${url}`)),
    );
  });
}

function ground(grass: THREE.Texture, sand: THREE.Texture): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(560, 560, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 4.5, pos.getZ(i) / 4.5);
  const material = new THREE.MeshStandardMaterial({ map: grass, roughness: 0.96, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.sandMap = { value: sand };
    shader.vertexShader = `varying vec3 vGroundWorld;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
       vGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );
    shader.fragmentShader = `varying vec3 vGroundWorld;\nuniform sampler2D sandMap;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       vec4 sandTex = texture2D(sandMap, vMapUv * 0.85);
       float dist = length(vGroundWorld.xz - vec2(0.0, 70.0));
       float sandMix = smoothstep(42.0, 125.0, dist);
       diffuseColor.rgb = mix(diffuseColor.rgb, sandTex.rgb, sandMix);
       float macro = 0.5 + 0.5 * sin(vMapUv.x * 1.9) * sin(vMapUv.y * 1.4);
       diffuseColor.rgb *= mix(0.9, 1.08, macro);`,
    );
  };
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = -0.04;
  mesh.receiveShadow = true;
  return mesh;
}

function texturedSurface(
  z0: number,
  z1: number,
  steps: number,
  heightAt: (z: number) => number,
  map: THREE.Texture,
  metersPerTile: number,
  roughness: number,
  metalness: number,
): THREE.Mesh {
  const nx = 10;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const row = nx + 1;
  for (let iz = 0; iz <= steps; iz++) {
    const z = z0 + ((z1 - z0) * iz) / steps;
    const y = heightAt(z);
    for (let ix = 0; ix <= nx; ix++) {
      const x = -TRACK_HALF_WIDTH + (2 * TRACK_HALF_WIDTH * ix) / nx;
      positions.push(x, y, z);
      uvs.push(x / metersPerTile, z / metersPerTile);
    }
  }
  for (let iz = 0; iz < steps; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const a = iz * row + ix;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ map, roughness, metalness });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       float macro = 0.5 + 0.5 * sin(vMapUv.x * 2.3) * sin(vMapUv.y * 1.8);
       diffuseColor.rgb *= mix(0.92, 1.06, macro);`,
    );
  };
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

function scatterTrees(atlas: THREE.Texture, meta: TreeMeta[], count: number): { foliage: THREE.InstancedMesh; shadows: THREE.InstancedMesh } {
  const rand = mulberry32(0x5eed);
  const placed: { x: number; z: number; h: number; kind: number }[] = [];
  let guard = 0;
  while (placed.length < count && guard < count * 40) {
    guard += 1;
    const x = (rand() * 2 - 1) * 78;
    const z = -12 + rand() * 210;
    if (Math.abs(x) < 13.5 && z > -6 && z < 188) continue;
    if (Math.abs(x) < 16 && z > 46 && z < 92) continue;
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

function dashes(): THREE.Mesh {
  const geos: THREE.BufferGeometry[] = [];
  for (let z = 2; z < 48; z += 4) {
    const dash = new THREE.BoxGeometry(0.28, 0.025, 1.5);
    dash.translate(0, 0.03, z);
    geos.push(dash);
  }
  const merged = mergeGeometries(geos);
  const mesh = new THREE.Mesh(merged ?? new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.55 }));
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
  return new THREE.Mesh(
    merged ?? new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({ color: 0xfff3a1, roughness: 0.45 }),
  );
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
    new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }),
  );
  mesh.add(new THREE.Mesh(mergeGeometries(darks) ?? new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.55 })));
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
