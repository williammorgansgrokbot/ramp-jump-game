import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { CarConfig } from './catalog';
import { TIRE_DROP, axlesFor, type Axle } from './carFit';

export interface Detachable {
  id: string;
  mesh: THREE.Object3D;
  localPos: THREE.Vector3;
  localQuat: THREE.Quaternion;
  half: THREE.Vector3;
  ball?: number;
  /** Downward speed (m/s) that pops this part off on a landing. */
  minSpeed: number;
  radius: number;
  wheelIndex?: number;
  detached: boolean;
}

const AXLE = new THREE.Vector3(1, 0, 0);
const WHEEL_NAMES = ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'] as const;

const FILES: Record<string, string> = {
  boy1: 'car_red',
  boy2: 'car_blue',
  boy3: 'car_green',
  boy4: 'car_yellow',
};

interface LoadedCar {
  root: THREE.Group;
  body: THREE.Mesh;
  wheels: THREE.Object3D[];
  parts: Detachable[];
  positionAttr: THREE.BufferAttribute;
  original: Float32Array;
}

export class ToyCar {
  readonly group = new THREE.Group();
  readonly wheels: THREE.Object3D[] = [];
  readonly parts: Detachable[] = [];
  dentCount = 0;

  private readonly loaded = new Map<string, LoadedCar>();
  private activeId = '';
  private body!: THREE.Mesh;
  private positionAttr!: THREE.BufferAttribute;
  private original!: Float32Array;

  private constructor() {
    this.group.name = 'toy-car';
  }

  static async create(opts: { base: string; mobile: boolean; anisotropy: number }): Promise<ToyCar> {
    const car = new ToyCar();
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    await Promise.all(
      Object.keys(FILES).map(async (id) => {
        const file = `${FILES[id]}${opts.mobile ? '_mobile' : ''}.glb`;
        const gltf = await loader.loadAsync(`${opts.base}art/cars/v3/${file}`);
        car.loaded.set(id, prepare(gltf.scene, id, opts.anisotropy));
      }),
    );
    car.use('boy1');
    return car;
  }

  axles(): Axle[] {
    return axlesFor(this.activeId || 'boy1');
  }

  /** Swap the visible TRELLIS model. Physics axles come from `axles()`. */
  setConfig(config: CarConfig): void {
    if (this.loaded.has(config.id)) this.use(config.id);
  }

  /** Baked eyes stay on the texture. Nothing procedural is left on the windshield. */
  updateFace(_dt: number, _mood: { steer: number; airborne: boolean; vy: number; crash: boolean }): void {}

  /** Push Body vertices inward near a point in the car group's local space. */
  dent(groupLocal: THREE.Vector3, strength: number): number {
    this.group.updateMatrixWorld(true);
    const world = this.group.localToWorld(groupLocal.clone());
    const point = this.body.worldToLocal(world);
    const scale = this.body.getWorldScale(new THREE.Vector3()).x || 1;
    const radius = (0.55 + strength * 0.75) / scale;
    const depth = (0.035 + strength * 0.14) / scale;
    const arr = this.positionAttr.array as Float32Array;
    let moved = 0;
    for (let i = 0; i < arr.length; i += 3) {
      const ox = this.original[i];
      const oy = this.original[i + 1];
      const oz = this.original[i + 2];
      const dist = Math.hypot(ox - point.x, oy - point.y, oz - point.z);
      if (dist > radius) continue;
      const falloff = Math.cos((dist / radius) * Math.PI * 0.5);
      const noise = 0.72 + 0.28 * Math.sin(ox * 18.2 + oy * 9.1 + oz * 13.4);
      const len = Math.hypot(ox, oy * 0.65, oz) || 1;
      const ix = -ox / len;
      const iy = -(oy * 0.65) / len;
      const iz = -oz / len;
      const push = depth * falloff * noise;
      const already = (arr[i] - ox) * ix + (arr[i + 1] - oy) * iy + (arr[i + 2] - oz) * iz;
      const target = Math.min(0.16 / scale, Math.max(already, push));
      if (target <= already + 0.001) continue;
      arr[i] = ox + ix * target;
      arr[i + 1] = oy + iy * target;
      arr[i + 2] = oz + iz * target;
      moved += 1;
    }
    if (moved > 0) {
      this.positionAttr.needsUpdate = true;
      this.body.geometry.computeVertexNormals();
      this.dentCount += moved;
    }
    return moved;
  }

  resetDamage(): void {
    if (!this.positionAttr) return;
    (this.positionAttr.array as Float32Array).set(this.original);
    this.positionAttr.needsUpdate = true;
    this.body.geometry.computeVertexNormals();
    this.dentCount = 0;
  }

  private use(id: string): void {
    const next = this.loaded.get(id);
    if (!next) return;
    const previous = this.loaded.get(this.activeId);
    if (previous) {
      this.group.remove(previous.root);
      for (const wheel of previous.wheels) wheel.removeFromParent();
    }
    this.activeId = id;
    this.group.add(next.root);
    for (const wheel of next.wheels) this.group.add(wheel);
    refreshTextures(next);
    this.wheels.splice(0, this.wheels.length, ...next.wheels);
    this.parts.splice(0, this.parts.length, ...next.parts);
    this.body = next.body;
    this.positionAttr = next.positionAttr;
    this.original = next.original;
  }
}

function prepare(scene: THREE.Group, id: string, anisotropy: number): LoadedCar {
  const axles = axlesFor(id);
  const yellow = id === 'boy4';
  const root = new THREE.Group();
  root.name = id;
  // Model y = 0 is the ground under the tires. Chassis y = 0 is a meter above that.
  root.position.y = -TIRE_DROP;
  root.add(scene);

  let shared: THREE.MeshPhysicalMaterial | null = null;
  const wheelMat = new Map<THREE.Material, THREE.MeshPhysicalMaterial>();
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const source = mesh.material;
    const previous = (Array.isArray(source) ? source[0] : source) as THREE.MeshStandardMaterial;
    const map = previous?.map ?? null;
    bakeTexture(map, anisotropy);
    const isWheel = WHEEL_NAMES.some((name) => mesh.name === name || mesh.parent?.name === name);
    if (!shared) shared = paint(map, yellow, false, `${id}_body`);
    const material = isWheel ? wheelMat.get(previous) ?? paint(map, yellow, true, `${id}_wheel`) : shared;
    if (isWheel && previous) wheelMat.set(previous, material);
    mesh.material = material;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    dequantize(mesh.geometry);
  });

  const bodyObj = scene.getObjectByName('Body');
  const body = (bodyObj && (bodyObj as THREE.Mesh).isMesh ? bodyObj : bodyObj?.children.find((child) => (child as THREE.Mesh).isMesh)) as THREE.Mesh;
  if (!body) throw new Error(`Car ${id} is missing a Body mesh`);
  const positionAttr = body.geometry.getAttribute('position') as THREE.BufferAttribute;
  const original = new Float32Array(positionAttr.array);

  const wheels: THREE.Object3D[] = [];
  const parts: Detachable[] = [];
  axles.forEach((axle, index) => {
    const node = scene.getObjectByName(axle.name);
    if (!node) throw new Error(`Car ${id} is missing ${axle.name}`);
    if (axle.name === 'Wheel_FL' || axle.name === 'Wheel_FR') clipSpike(node);
    node.parent?.remove(node);
    wheels.push(node);
    const local = new THREE.Vector3(axle.x, axle.radius - TIRE_DROP, axle.z);
    node.position.copy(local);
    node.quaternion.identity();
    parts.push({
      id: `wheel-${index}`,
      mesh: node,
      localPos: local.clone(),
      localQuat: new THREE.Quaternion(),
      half: new THREE.Vector3(0.16, axle.radius, axle.radius),
      ball: axle.radius,
      minSpeed: 13,
      radius: 1.8,
      wheelIndex: index,
      detached: false,
    });
  });

  // Liners live in model space (y up from the ground) so they sit in the arches.
  addLiners(scene, axles);

  return { root, body, wheels, parts, positionAttr, original };
}

/** Copy the decoded image into a canvas so WebKit can upload it after the glTF blob URL is revoked. */
const refreshed = new WeakSet<THREE.Mesh>();

/** Build the glossy material at the moment the car is shown. A physical material created earlier uploads black on WebKit. */
function refreshTextures(model: LoadedCar): void {
  const apply = (mesh: THREE.Mesh) => {
    const current = mesh.material as THREE.MeshPhysicalMaterial;
    if (!current?.map || refreshed.has(mesh)) return;
    const image = current.map.image as HTMLCanvasElement | undefined;
    if (!image) return;
    const tex = new THREE.CanvasTexture(image);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = current.map.anisotropy;
    tex.needsUpdate = true;
    const wheel = mesh.name.startsWith('Wheel_');
    const next = new THREE.MeshPhysicalMaterial({
      map: tex,
      color: current.color,
      roughness: wheel ? 0.55 : 0.3,
      metalness: 0.02,
      clearcoat: wheel ? 0.35 : 1,
      clearcoatRoughness: wheel ? 0.35 : 0.14,
      envMapIntensity: 1.35,
    });
    if (current.userData.yellow) {
      next.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           {
             float luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
             diffuseColor.rgb = mix(vec3(luma), diffuseColor.rgb, 1.45);
             diffuseColor.rgb *= vec3(1.06, 0.98, 0.78);
           }`,
        );
      };
    }
    mesh.material = next;
    refreshed.add(mesh);
  };
  model.root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) apply(mesh);
  });
  for (const wheel of model.wheels) {
    wheel.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) apply(mesh);
    });
  }
}

/** glTF positions and normals are padded (xyz + 0). Expand them to tight floats so every car lights the same. */
function dequantize(geometry: THREE.BufferGeometry): void {
  expand(geometry, 'position', 32767);
  expand(geometry, 'normal', 127);
}

function expand(geometry: THREE.BufferGeometry, name: string, denom: number): void {
  const attr = geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
  if (!attr || attr.array instanceof Float32Array) return;
  const src = attr.array as Int16Array | Int8Array;
  const stride = src.length / attr.count;
  const scale = attr.normalized ? denom : 1;
  const floats = new Float32Array(attr.count * 3);
  for (let i = 0; i < attr.count; i++) {
    const o = i * stride;
    floats[i * 3] = src[o] / scale;
    floats[i * 3 + 1] = src[o + 1] / scale;
    floats[i * 3 + 2] = src[o + 2] / scale;
  }
  geometry.setAttribute(name, new THREE.BufferAttribute(floats, 3));
}

function bakeTexture(map: THREE.Texture | null, anisotropy: number): void {
  const image = map?.image as (CanvasImageSource & { width?: number; height?: number }) | undefined;
  if (!map || !image?.width || !image.height) return;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d')?.drawImage(image, 0, 0);
  map.image = canvas;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = anisotropy;
  map.needsUpdate = true;
}

function paint(map: THREE.Texture | null, yellow: boolean, wheel: boolean, key: string): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    map,
    color: yellow && !wheel ? new THREE.Color(1.12, 1.02, 0.72) : new THREE.Color(0xffffff),
    roughness: wheel ? 0.55 : 0.3,
    metalness: 0.02,
    clearcoat: wheel ? 0.35 : 1,
    clearcoatRoughness: wheel ? 0.35 : 0.14,
    envMapIntensity: 1.35,
  });
  // WebKit reuses one physical-shader program and the later cars' maps sample black.
  const token = key.replace(/[^a-z0-9]/gi, '_').toUpperCase();
  if (yellow && !wheel) material.userData.yellow = true;
  material.customProgramCacheKey = () => token;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = `#define CAR_${token}\n` + shader.fragmentShader;
    if (yellow && !wheel) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           float luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
           diffuseColor.rgb = mix(vec3(luma), diffuseColor.rgb, 1.45);
           diffuseColor.rgb *= vec3(1.06, 0.98, 0.78);
         }`,
      );
    }
  };
  return material;
}

/** Drop front-wheel faces that stick out past the tire, including the body spike on the front-left wheel. */
function clipSpike(node: THREE.Object3D): void {
  node.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    const attr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const index = geometry.getIndex();
    if (!attr || !index) return;
    const arr = attr.array as ArrayLike<number>;
    const radii: number[] = [];
    for (let i = 1; i < arr.length; i += 3) radii.push(Math.hypot(arr[i], arr[i + 1]));
    radii.sort((a, b) => a - b);
    const radial = radii[Math.floor(radii.length * 0.92)] || 1;
    const bad = new Uint8Array(attr.count);
    for (let i = 0; i < attr.count; i++) {
      if (Math.hypot(arr[i * 3 + 1], arr[i * 3 + 2]) > radial * 1.08) bad[i] = 1;
    }
    const src = index.array;
    const keep: number[] = [];
    for (let i = 0; i < src.length; i += 3) {
      if (bad[src[i]] || bad[src[i + 1]] || bad[src[i + 2]]) continue;
      keep.push(src[i], src[i + 1], src[i + 2]);
    }
    geometry.setIndex(keep);
  });
}

function addLiners(scene: THREE.Object3D, axles: Axle[]): void {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 28);
  geo.rotateZ(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x12141a,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  for (const axle of axles) {
    const liner = new THREE.Mesh(geo, mat);
    const inward = Math.sign(axle.x) || 1;
    liner.position.set(axle.x - inward * 0.22, axle.radius, axle.z);
    liner.scale.set(0.06, axle.radius * 1.04, axle.radius * 1.04);
    liner.castShadow = false;
    liner.receiveShadow = true;
    scene.add(liner);
  }
}

export { AXLE };
