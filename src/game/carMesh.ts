import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { carById } from './catalog';
import { axlesFor, modelFile, vehicleSpec, type Axle, type VehicleType } from './carFit';

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

  private active: LoadedCar | null = null;
  private activeKey = '';
  private body!: THREE.Mesh;
  private positionAttr!: THREE.BufferAttribute;
  private original!: Float32Array;
  private loader!: GLTFLoader;
  private base = '';
  private mobile = false;
  private anisotropy = 4;
  type: VehicleType = 'car';
  colorId = 'boy1';

  private constructor() {
    this.group.name = 'toy-car';
  }

  static async create(opts: { base: string; mobile: boolean; anisotropy: number; type: VehicleType; id: string }): Promise<ToyCar> {
    const car = new ToyCar();
    car.loader = new GLTFLoader();
    car.loader.setMeshoptDecoder(MeshoptDecoder);
    car.base = opts.base;
    car.mobile = opts.mobile;
    car.anisotropy = opts.anisotropy;
    await car.show(opts.type, opts.id);
    return car;
  }

  axles(): Axle[] {
    return axlesFor(this.type, this.colorId);
  }

  /** Load just this vehicle, drop the previous model, and show it. */
  async show(type: VehicleType, id: string): Promise<void> {
    const key = `${type}:${id}`;
    if (this.activeKey === key && this.active) return;
    const file = modelFile(type, id, this.mobile);
    const gltf = await this.loader.loadAsync(`${this.base}art/${file}`);
    const next = prepare(gltf.scene, type, id, this.anisotropy);
    this.disposeActive();
    this.type = type;
    this.colorId = id;
    this.activeKey = key;
    this.active = next;
    this.group.add(next.root);
    for (const wheel of next.wheels) this.group.add(wheel);
    refreshTextures(next);
    this.wheels.splice(0, this.wheels.length, ...next.wheels);
    this.parts.splice(0, this.parts.length, ...next.parts);
    this.body = next.body;
    this.positionAttr = next.positionAttr;
    this.original = next.original;
  }

  private disposeActive(): void {
    const previous = this.active;
    if (!previous) return;
    this.group.remove(previous.root);
    for (const wheel of previous.wheels) wheel.removeFromParent();
    const dump = (obj: THREE.Object3D) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const mapped = material as THREE.MeshPhysicalMaterial;
        mapped.map?.dispose();
        material.dispose();
      }
    };
    previous.root.traverse(dump);
    for (const wheel of previous.wheels) wheel.traverse(dump);
    this.active = null;
    this.activeKey = '';
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

}

function prepare(scene: THREE.Group, type: VehicleType, id: string, anisotropy: number): LoadedCar {
  const axles = axlesFor(type, id);
  const drop = vehicleSpec(type).drop;
  const yellow = id === 'boy4';
  const root = new THREE.Group();
  root.name = `${type}-${id}`;
  // Model y = 0 is the ground under the tires.
  root.position.y = -drop;
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
    if (!shared) shared = paint(map, yellow, false, `${type}_${id}_body`);
    const material = isWheel ? wheelMat.get(previous) ?? paint(map, yellow, true, `${type}_${id}_wheel`) : shared;
    if (isWheel && previous) wheelMat.set(previous, material);
    mesh.material = material;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    dequantize(mesh.geometry);
  });

  const bodyObj = scene.getObjectByName('Body');
  const body = (bodyObj && (bodyObj as THREE.Mesh).isMesh ? bodyObj : bodyObj?.children.find((child) => (child as THREE.Mesh).isMesh)) as THREE.Mesh;
  if (!body) throw new Error(`${type} ${id} is missing a Body mesh`);
  const positionAttr = body.geometry.getAttribute('position') as THREE.BufferAttribute;
  const original = new Float32Array(positionAttr.array);

  const wheels: THREE.Object3D[] = [];
  const parts: Detachable[] = [];
  axles.forEach((axle, index) => {
    const node = scene.getObjectByName(axle.name);
    if (!node) throw new Error(`${type} ${id} is missing ${axle.name}`);
    if (type === 'car' && (axle.name === 'Wheel_FL' || axle.name === 'Wheel_FR')) clipSpike(node);
    node.parent?.remove(node);
    wheels.push(node);
    const local = new THREE.Vector3(axle.x, axle.radius - drop, axle.z);
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
  addNamePlates(scene, body, type, carById(id).name, carById(id).body);

  return { root, body, wheels, parts, positionAttr, original };
}

/** Rear plate plus a door decal. Both face outward so the name reads in the chase view and from the side. */
function addNamePlates(scene: THREE.Group, body: THREE.Mesh, type: VehicleType, name: string, ink: string): void {
  scene.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(body);
  const height = Math.max(0.4, bb.max.y - bb.min.y);
  const wide = type === 'monster' ? 1.15 : 0.92;

  const rear = makeNamePlate(name, ink, wide);
  const rearX = type === 'jeep' ? bb.max.x * 0.38 : 0;
  const rearY = bb.min.y + height * (type === 'car' ? 0.3 : 0.4);
  rear.position.set(rearX, rearY, bb.min.z - 0.04);
  rear.rotation.y = Math.PI;
  scene.add(rear);

  const side = makeNamePlate(name, ink, wide * 0.92);
  side.position.set(bb.max.x + 0.035, bb.min.y + height * 0.5, (bb.min.z + bb.max.z) * 0.02);
  side.rotation.y = -Math.PI / 2;
  scene.add(side);
}

function makeNamePlate(name: string, ink: string, width: number): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.Mesh(new THREE.PlaneGeometry(width, width * 0.31));
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  roundPlate(ctx, 10, 14, 492, 132, 40);
  ctx.fillStyle = '#fffdf8';
  ctx.fill();
  ctx.lineWidth = 16;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.fillStyle = '#1d2430';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 96;
  const family = '"Arial Rounded MT Bold", "Trebuchet MS", Verdana, sans-serif';
  ctx.font = `800 ${size}px ${family}`;
  while (ctx.measureText(name).width > 430 && size > 52) {
    size -= 4;
    ctx.font = `800 ${size}px ${family}`;
  }
  ctx.fillText(name, 256, 82);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width * (160 / 512)),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.name = 'name-plate';
  mesh.renderOrder = 2;
  return mesh;
}

function roundPlate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Copy the decoded image into a canvas so WebKit can upload it after the glTF blob URL is revoked. */
const refreshed = new WeakSet<THREE.Mesh>();

/** Build the glossy material at the moment the car is shown. A physical material created earlier uploads black on WebKit. */
function refreshTextures(model: LoadedCar): void {
  const apply = (mesh: THREE.Mesh) => {
    if (mesh.name === 'name-plate' || refreshed.has(mesh)) return;
    const current = mesh.material as THREE.MeshPhysicalMaterial;
    if (!current?.map) return;
    const image = current.map.image as HTMLCanvasElement | undefined;
    if (!image) return;
    const tex = new THREE.CanvasTexture(image);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = current.map.anisotropy;
    tex.needsUpdate = true;
    const wheel = mesh.name.startsWith('Wheel_');
    const yellow = Boolean(current.userData.yellow);
    const next = new THREE.MeshPhysicalMaterial({
      map: tex,
      color: current.color,
      ...finishParams(wheel),
    });
    const token = `REFRESH_${wheel ? 'W' : 'B'}_${yellow ? 'Y' : 'N'}_${tex.uuid.replace(/[^a-z0-9]/gi, '')}`;
    compileFinish(next, token, yellow, wheel);
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

/** Clearcoat body, dull rubber tires. The scene environment is the coded sky. */
function finishParams(wheel: boolean): THREE.MeshPhysicalMaterialParameters {
  if (wheel) {
    return {
      roughness: 0.48,
      metalness: 0.04,
      specularIntensity: 0.4,
      clearcoat: 0.08,
      clearcoatRoughness: 0.55,
      envMapIntensity: 0.32,
    };
  }
  return {
    roughness: 0.16,
    metalness: 0,
    specularIntensity: 0.7,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    envMapIntensity: 1.45,
  };
}

function compileFinish(material: THREE.MeshPhysicalMaterial, token: string, yellow: boolean, wheel: boolean): void {
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
           diffuseColor.rgb = mix(vec3(luma), diffuseColor.rgb, 1.28);
           diffuseColor.rgb *= vec3(1.04, 0.99, 0.82);
         }`,
      );
    }
    if (wheel) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
         float tireLuma = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
         float tire = smoothstep(0.36, 0.1, tireLuma);
         roughnessFactor = mix(roughnessFactor, 0.96, tire);`,
      );
    }
  };
}

function paint(map: THREE.Texture | null, yellow: boolean, wheel: boolean, key: string): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    map,
    color: yellow && !wheel ? new THREE.Color(1.08, 1.01, 0.78) : new THREE.Color(0xffffff),
    ...finishParams(wheel),
  });
  // WebKit reuses one physical-shader program and the later cars' maps sample black.
  const token = key.replace(/[^a-z0-9]/gi, '_').toUpperCase();
  compileFinish(material, token, yellow, wheel);
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
