import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { CarConfig } from './catalog';

export interface Detachable {
  id: string;
  mesh: THREE.Object3D;
  localPos: THREE.Vector3;
  localQuat: THREE.Quaternion;
  half: THREE.Vector3;
  ball?: number;
  /** Downward speed (m/s) that pops this part off on a landing. */
  minSpeed: number;
  /** Only parts near the hit pop, unless the radius is generous. */
  radius: number;
  wheelIndex?: number;
  detached: boolean;
}

const AXLE = new THREE.Vector3(1, 0, 0);

export class ToyCar {
  readonly group = new THREE.Group();
  readonly wheels: THREE.Object3D[] = [];
  readonly parts: Detachable[] = [];
  dentCount = 0;

  private readonly body: THREE.Mesh;
  private readonly bodyMat: THREE.MeshPhysicalMaterial;
  private readonly accentMat: THREE.MeshPhysicalMaterial;
  private readonly roofMat: THREE.MeshPhysicalMaterial;
  private readonly plateMat: THREE.MeshStandardMaterial;
  private readonly plateTex: THREE.CanvasTexture;
  private readonly plateCanvas: HTMLCanvasElement;
  private readonly original: Float32Array;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly eyeRoots: THREE.Group[] = [];
  private readonly lids: THREE.Mesh[] = [];
  private readonly irises: THREE.Mesh[] = [];
  private readonly lidMat: THREE.MeshStandardMaterial;
  private readonly irisMat: THREE.MeshStandardMaterial;
  private blink = 2.4;
  private blinkLeft = 0;
  private dizzy = 0;
  private squint = 0;
  private wide = 0;

  constructor(config: CarConfig) {
    this.group.name = 'toy-car';

    this.bodyMat = paint(config.body, { clearcoat: 1, clearcoatRoughness: 0.08, roughness: 0.2, metalness: 0.32 });
    this.bodyMat.envMapIntensity = 1.6;
    this.accentMat = paint(config.accent, { clearcoat: 0.7, roughness: 0.32, metalness: 0.15 });
    this.roofMat = paint(config.roof, { clearcoat: 0.5, roughness: 0.35, metalness: 0.05 });
    this.plateCanvas = document.createElement('canvas');
    this.plateCanvas.width = 256;
    this.plateCanvas.height = 128;
    this.plateTex = new THREE.CanvasTexture(this.plateCanvas);
    this.plateTex.colorSpace = THREE.SRGBColorSpace;
    this.plateTex.anisotropy = 4;
    this.plateMat = new THREE.MeshStandardMaterial({ map: this.plateTex, roughness: 0.45, metalness: 0.05 });

    this.lidMat = new THREE.MeshStandardMaterial({ color: config.body, roughness: 0.35, metalness: 0.05 });
    this.irisMat = new THREE.MeshStandardMaterial({ color: config.iris, roughness: 0.3 });
    const bodyGeo = sculptShell();
    this.body = new THREE.Mesh(bodyGeo, this.bodyMat);
    this.body.position.set(0, 0, 0);
    this.body.castShadow = true;
    this.body.name = 'shell';
    this.group.add(this.body);
    this.positionAttr = bodyGeo.attributes.position as THREE.BufferAttribute;
    this.original = new Float32Array(this.positionAttr.array);

    this.addCabin();
    this.addFenders();
    this.addEyes();
    this.addChrome();
    this.addLights();
    this.paintPlate(config);
    this.addPlate(0, -0.08, -1.58, 0.4, 0.16);

    this.part('hood', box(1.05, 0.02, 0.42, this.bodyMat), new THREE.Vector3(0, 0.08, 0.82), 9, 1.5);
    this.part('trunk', box(1.08, 0.028, 0.42, this.bodyMat), new THREE.Vector3(0, 0.12, -0.82), 11, 1.4);
    this.part('bumper-front', bumper(true, this.bodyMat), new THREE.Vector3(0, 0.0, 1.62), 6, 1.4);
    this.part('bumper-rear', bumper(false, this.bodyMat), new THREE.Vector3(0, -0.2, -1.55), 8, 1.35);
    this.part('door-left', box(0.035, 0.26, 0.58, this.bodyMat), new THREE.Vector3(-1.03, -0.14, 0.02), 12, 1.2);
    this.part('door-right', box(0.035, 0.26, 0.58, this.bodyMat), new THREE.Vector3(1.03, -0.14, 0.02), 12, 1.2);
    this.part('spoiler', this.spoiler(), new THREE.Vector3(0, 0.18, -1.32), 7, 1.6);

    const tire = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.72, metalness: 0.05 });
    const hub = new THREE.MeshPhysicalMaterial({ color: config.rim, metalness: 0.82, roughness: 0.18, clearcoat: 0.7, envMapIntensity: 1.3 });
    const wheelPoints: Array<[number, number, number]> = [
      [-0.82, -0.2, 0.95],
      [0.82, -0.2, 0.95],
      [-0.82, -0.2, -1],
      [0.82, -0.2, -1],
    ];
    wheelPoints.forEach((point, index) => {
      const wheel = makeWheel(tire, hub);
      wheel.position.set(point[0], point[1], point[2]);
      this.group.add(wheel);
      this.wheels.push(wheel);
      this.parts.push({
        id: `wheel-${index}`,
        mesh: wheel,
        localPos: wheel.position.clone(),
        localQuat: wheel.quaternion.clone(),
        half: new THREE.Vector3(0.2, 0.38, 0.38),
        ball: 0.38,
        minSpeed: 14,
        radius: 1.15,
        wheelIndex: index,
        detached: false,
      });
    });

    this.setConfig(config);
  }

  setConfig(config: CarConfig): void {
    this.bodyMat.color.set(config.body);
    this.accentMat.color.set(config.accent);
    this.roofMat.color.set(config.roof);
    this.lidMat.color.set(config.body);
    this.irisMat.color.set(config.iris);
    this.paintPlate(config);
    for (const wheel of this.wheels) {
      const cap = wheel.getObjectByName('hub') as THREE.Mesh | undefined;
      const material = cap?.material;
      if (material && !Array.isArray(material) && material instanceof THREE.MeshPhysicalMaterial) material.color.set(config.rim);
    }
  }

  /** Windshield eyes follow the drive and react to jumps and crashes. */
  updateFace(dt: number, mood: { steer: number; airborne: boolean; vy: number; crash: boolean }): void {
    if (mood.crash) {
      this.dizzy = 1.4;
      this.squint = 0.7;
    }
    this.dizzy = Math.max(0, this.dizzy - dt);
    this.squint = Math.max(0, this.squint - dt);
    const wantWide = mood.airborne && mood.vy > -1 ? 1 : 0;
    this.wide += (wantWide - this.wide) * Math.min(1, dt * 6);
    this.blink -= dt;
    if (this.blinkLeft > 0) this.blinkLeft = Math.max(0, this.blinkLeft - dt);
    else if (this.blink <= 0) {
      this.blinkLeft = 0.14;
      this.blink = 2.6 + Math.random() * 2.2;
    }
    const blinkAmt = this.blinkLeft > 0 ? Math.sin((this.blinkLeft / 0.14) * Math.PI) : 0;
      const lidClose = Math.min(1, blinkAmt * 0.9 + this.squint * 0.55);
    const look = THREE.MathUtils.clamp(mood.steer * 0.45, -0.5, 0.5);
    this.eyeRoots.forEach((eye, index) => {
      const side = index === 0 ? -1 : 1;
      eye.rotation.y = look + (this.dizzy > 0 ? Math.sin(this.dizzy * 18) * 0.5 : 0);
      eye.rotation.x = (mood.airborne ? -0.18 : 0.04) + this.wide * -0.08;
      eye.scale.setScalar(1 + this.wide * 0.12);
      const lid = this.lids[index];
      if (lid) lid.rotation.x = -0.35 + lidClose * 1.15;
      const iris = this.irises[index];
      if (iris) iris.rotation.z = this.dizzy > 0 ? this.dizzy * 14 * side : look * 0.4;
    });
  }

  /** Push shell vertices inward near a point in the shell's local space. Returns vertices moved. */
  dent(localOnGroup: THREE.Vector3, strength: number): number {
    const point = localOnGroup.clone().sub(this.body.position);
    const radius = 0.42 + strength * 0.62;
    const depth = 0.045 + strength * 0.22;
    const arr = this.positionAttr.array as Float32Array;
    let moved = 0;
    for (let i = 0; i < arr.length; i += 3) {
      const ox = this.original[i];
      const oy = this.original[i + 1];
      const oz = this.original[i + 2];
      const dx = ox - point.x;
      const dy = oy - point.y;
      const dz = oz - point.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > radius) continue;
      const falloff = Math.cos((dist / radius) * Math.PI * 0.5);
      const noise = 0.72 + 0.28 * Math.sin(ox * 18.2 + oy * 9.1 + oz * 13.4);
      const len = Math.hypot(ox, oy * 0.65, oz) || 1;
      const ix = -ox / len;
      const iy = -(oy * 0.65) / len;
      const iz = -oz / len;
      const push = depth * falloff * noise;
      const already = (arr[i] - ox) * ix + (arr[i + 1] - oy) * iy + (arr[i + 2] - oz) * iz;
      const target = Math.min(0.34, Math.max(already, push));
      if (target <= already + 0.0015) continue;
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
    (this.positionAttr.array as Float32Array).set(this.original);
    this.positionAttr.needsUpdate = true;
    this.body.geometry.computeVertexNormals();
    this.dentCount = 0;
  }

  private addCabin(): void {
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xd7f3ff,
      roughness: 0.04,
      metalness: 0,
      transparent: true,
      opacity: 0.55,
      envMapIntensity: 1.2,
      depthWrite: false,
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.45, metalness: 0.25 });
    const shell = new THREE.Mesh(new RoundedBoxGeometry(1.08, 0.32, 0.78, 3, 0.08), this.bodyMat);
    shell.position.set(0, 0.2, 0.02);
    shell.castShadow = true;
    this.group.add(shell);
    const interior = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.18, 0.36, 2, 0.03), frameMat);
    interior.position.set(0, 0.24, 0.04);
    this.group.add(interior);
    const roof = new THREE.Mesh(new RoundedBoxGeometry(1.02, 0.045, 0.5, 2, 0.02), this.bodyMat);
    roof.position.set(0, 0.36, 0.0);
    roof.castShadow = true;
    this.group.add(roof);
    const windshield = new THREE.Mesh(new RoundedBoxGeometry(1.22, 0.5, 0.03, 3, 0.012), glassMat);
    windshield.position.set(0, 0.26, 0.32);
    windshield.rotation.x = -0.55;
    this.group.add(windshield);
    const header = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.038, 0.04, 2, 0.01), frameMat);
    header.position.set(0, 0.42, 0.18);
    header.rotation.x = -0.5;
    this.group.add(header);
    const rearGlass = new THREE.Mesh(new RoundedBoxGeometry(1.04, 0.32, 0.03, 2, 0.01), glassMat);
    rearGlass.position.set(0, 0.3, -0.24);
    rearGlass.rotation.x = 0.72;
    this.group.add(rearGlass);
    const sideMat = glassMat.clone();
    sideMat.side = THREE.DoubleSide;
    sideMat.depthWrite = false;
    for (const x of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.32), sideMat);
      side.position.set(x * 0.58, 0.28, 0.02);
      side.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.group.add(side);
      const pillar = new THREE.Mesh(new RoundedBoxGeometry(0.038, 0.4, 0.038, 2, 0.01), frameMat);
      pillar.position.set(x * 0.58, 0.26, 0.28);
      pillar.rotation.x = -0.62;
      this.group.add(pillar);
      const mirror = new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), this.bodyMat);
      mirror.scale.set(1.55, 0.68, 0.8);
      mirror.position.set(x * 0.72, 0.18, 0.3);
      this.group.add(mirror);
    }
  }

  private addFenders(): void {
    const arc = Math.PI * 0.78;
    const geo = new THREE.TorusGeometry(0.43, 0.05, 8, 18, arc);
    geo.rotateZ(Math.PI / 2 - arc / 2);
    geo.rotateY(Math.PI / 2);
    for (const z of [0.95, -1]) {
      for (const x of [-0.9, 0.9]) {
        const lip = new THREE.Mesh(geo, this.bodyMat);
        lip.position.set(x, -0.62, z);
        lip.castShadow = true;
        this.group.add(lip);
      }
    }
  }

  private addEyes(): void {
    const white = new THREE.MeshStandardMaterial({ color: 0xfffdf8, roughness: 0.22 });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 0.28 });
    const glintMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6 });
    for (const x of [-0.15, 0.15]) {
      const root = new THREE.Group();
      root.position.set(x, 0.28, 0.42);
      const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.155, 22, 16), white);
      sclera.scale.set(1.08, 1.22, 0.42);
      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.086, 16, 12), this.irisMat);
      iris.position.z = 0.055;
      iris.scale.set(1, 1, 0.4);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.046, 12, 10), pupilMat);
      pupil.position.z = 0.072;
      pupil.scale.z = 0.35;
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), glintMat);
      glint.position.set(0.03, 0.04, 0.09);
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.158, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), this.lidMat);
      lid.scale.set(1.08, 0.62, 0.42);
      lid.position.set(0, 0.09, 0.01);
      root.add(sclera, iris, pupil, glint, lid);
      this.group.add(root);
      this.eyeRoots.push(root);
      this.lids.push(lid);
      this.irises.push(iris);
    }
  }

  private addChrome(): void {
    const chrome = new THREE.MeshPhysicalMaterial({
      color: 0xe7eef6,
      metalness: 1,
      roughness: 0.12,
      envMapIntensity: 1.5,
    });
    for (const x of [-1, 1]) {
      const sill = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 1.05, 4, 8), chrome);
      sill.rotation.x = Math.PI / 2;
      sill.position.set(x * 0.98, -0.46, 0.02);
      this.group.add(sill);
    }
  }

  private addLights(): void {
    const head = new THREE.MeshStandardMaterial({
      color: 0xfff6d2,
      emissive: 0xfff1c2,
      emissiveIntensity: 0.65,
      roughness: 0.22,
    });
    const tail = new THREE.MeshStandardMaterial({
      color: 0xff2d2d,
      emissive: 0xff1d1d,
      emissiveIntensity: 0.7,
      roughness: 0.3,
    });
    for (const x of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), head);
      lamp.scale.set(1.7, 0.48, 0.36);
      lamp.position.set(x * 0.36, 0.02, 1.46);
      lamp.rotation.y = x * -0.35;
      this.group.add(lamp);
      const rear = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.09, 0.04), tail);
      rear.position.set(x * 0.48, -0.02, -1.58);
      this.group.add(rear);
    }
  }

  private spoiler(): THREE.Object3D {
    const group = new THREE.Group();
    const wing = new THREE.Mesh(new RoundedBoxGeometry(1.46, 0.05, 0.34, 2, 0.02), this.bodyMat);
    wing.position.y = 0.2;
    wing.rotation.x = -0.22;
    wing.castShadow = true;
    group.add(wing);
    const strutMat = new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.4, metalness: 0.3 });
    for (const x of [-0.42, 0.42]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.07), strutMat);
      strut.position.set(x, 0.06, 0.02);
      group.add(strut);
    }
    return group;
  }

  private part(id: string, mesh: THREE.Object3D, pos: THREE.Vector3, minSpeed: number, radius: number): void {
    mesh.position.copy(pos);
    mesh.traverse((child) => {
      const meshChild = child as THREE.Mesh;
      if (meshChild.isMesh) meshChild.castShadow = true;
    });
    this.group.add(mesh);
    const box3 = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    box3.getSize(size);
    this.parts.push({
      id,
      mesh,
      localPos: pos.clone(),
      localQuat: mesh.quaternion.clone(),
      half: size.multiplyScalar(0.5).clamp(new THREE.Vector3(0.05, 0.05, 0.05), new THREE.Vector3(0.8, 0.5, 0.8)),
      minSpeed,
      radius,
      detached: false,
    });
  }

  private paintPlate(config: CarConfig): void {
    const ctx = this.plateCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 256, 128);
    ctx.fillStyle = config.plate;
    roundRect(ctx, 6, 6, 244, 116, 22);
    ctx.fill();
    ctx.fillStyle = config.accent;
    ctx.font = '700 28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(config.name, 128, 38);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 68px system-ui, sans-serif';
    ctx.fillText(config.numeral, 128, 86);
    this.plateTex.needsUpdate = true;
  }

  private addPlate(x: number, y: number, z: number, w: number, h: number): void {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.plateMat);
    plate.position.set(x, y, z);
    if (z > 0) plate.position.z += 0.01;
    else plate.rotation.y = Math.PI;
    this.group.add(plate);
  }
}

function paint(color: string, opts: { clearcoat: number; clearcoatRoughness?: number; roughness: number; metalness: number }): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: opts.metalness,
    roughness: opts.roughness,
    clearcoat: opts.clearcoat,
    clearcoatRoughness: opts.clearcoatRoughness ?? 0.2,
    envMapIntensity: 1.15,
  });
}

function box(w: number, h: number, d: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.18), material);
  mesh.castShadow = true;
  return mesh;
}

function bumper(front: boolean, body: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(front ? 0.46 : 1.1, front ? 0.07 : 0.12, front ? 0.05 : 0.12, 2, 0.02), body);
  if (front) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.18, 0.03);
    shape.quadraticCurveTo(0, -0.08, 0.18, 0.03);
    shape.quadraticCurveTo(0, -0.02, -0.18, 0.03);
    const smile = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshStandardMaterial({ color: 0xfff8f4, roughness: 0.3, side: THREE.DoubleSide }),
    );
    smile.position.set(0, 0.0, 0.05);
    mesh.add(smile);
  }
  return mesh;
}

function blister(w: number, h: number, d: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 14), material);
  mesh.scale.set(w, h, d);
  mesh.castShadow = true;
  return mesh;
}

/**
 * Long, low sports-car hull. Stations are half-width, rocker, hood center, and fender crown.
 * The side rocker rises in a circle over each wheel so the tires sit in the arches.
 * The cabin, eyes, and lights are separate pieces on top of this shell.
 */
function sculptShell(): THREE.BufferGeometry {
  const stations: Array<[number, number, number, number, number]> = [
    [-1.68, 0.72, -0.28, 0.02, 0.04],
    [-1.32, 1.06, -0.5, 0.08, 0.12],
    [-1.0, 1.14, -0.56, 0.08, 0.12],
    [-0.45, 1.06, -0.58, 0.1, 0.11],
    [0.1, 1.06, -0.58, 0.11, 0.11],
    [0.5, 1.08, -0.56, 0.08, 0.12],
    [0.95, 1.14, -0.52, 0.04, 0.12],
    [1.28, 1.02, -0.34, 0.0, 0.06],
    [1.42, 0.78, -0.26, -0.02, 0.01],
    [1.58, 0.5, -0.16, -0.04, -0.02],
  ];
  const zCount = 46;
  const aCount = 32;
  const zMin = stations[0][0];
  const zMax = stations[stations.length - 1][0];
  const sample = (z: number) => {
    let i = 0;
    while (i < stations.length - 2 && z > stations[i + 1][0]) i += 1;
    const span = stations[i + 1][0] - stations[i][0] || 1;
    const t = Math.min(1, Math.max(0, (z - stations[i][0]) / span));
    const s = t * t * (3 - 2 * t);
    const at = (k: number) => stations[i][k] + (stations[i + 1][k] - stations[i][k]) * s;
    return { hw: Math.max(0.4, at(1)), y0: at(2), hood: at(3), fender: at(4) };
  };
  const positions: number[] = [];
  for (let iz = 0; iz <= zCount; iz++) {
    const z = zMin + (iz / zCount) * (zMax - zMin);
    const { hw, y0, hood, fender } = sample(z);
    const ySide = sideBottom(z, y0);
    for (let ia = 0; ia <= aCount; ia++) {
      const ang = (ia / aCount) * Math.PI * 2;
      const s = Math.sin(ang);
      const c = Math.cos(ang);
      const p = 4.2;
      let sx = Math.sign(s) * Math.abs(s) ** (2 / p);
      let sy = Math.sign(c) * Math.abs(c) ** (2 / p);
      if (sy < 0) sy = -(Math.abs(sy) ** 0.38);
      else sy = Math.abs(sy) ** 0.72;
      const side = smoothstep(0.08, 0.86, Math.abs(sx));
      const skirt = y0 + (ySide - y0) * side;
      const belly = y0 + 0.16;
      const bottom = belly + (skirt - belly) * side;
      const top = hood + (fender - hood) * smoothstep(0.2, 0.92, Math.abs(sx));
      const y = bottom + ((sy + 1) / 2) * (top - bottom);
      const x = sx * hw * (1 + 0.02 * side * Math.max(0, sy));
      positions.push(x, y, z);
    }
  }
  const row = aCount + 1;
  const indices: number[] = [];
  for (let iz = 0; iz < zCount; iz++) {
    for (let ia = 0; ia < aCount; ia++) {
      const a = iz * row + ia;
      indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const tail = positions.length / 3;
  positions.push(0, -0.08, zMin);
  for (let ia = 0; ia < aCount; ia++) indices.push(tail, ia + 1, ia);
  const nose = positions.length / 3;
  positions.push(0, -0.12, zMax);
  const noseRing = zCount * row;
  for (let ia = 0; ia < aCount; ia++) indices.push(nose, noseRing + ia + 1, noseRing + ia);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const normals = geo.attributes.normal.array as Float32Array;
  for (let iz = 0; iz <= zCount; iz++) {
    const a = iz * row * 3;
    const b = (iz * row + aCount) * 3;
    for (let k = 0; k < 3; k++) normals[a + k] = normals[b + k] = normals[a + k] + normals[b + k];
    const len = Math.hypot(normals[a], normals[a + 1], normals[a + 2]) || 1;
    for (let k = 0; k < 3; k++) {
      normals[a + k] /= len;
      normals[b + k] /= len;
    }
  }
  geo.attributes.normal.needsUpdate = true;
  return geo;
}

/** Side rocker. The arch itself is the wheel-well recess, not a raised skirt. */
function sideBottom(z: number, y0: number): number {
  void z;
  return y0;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1)));
  return t * t * (3 - 2 * t);
}

const VISUAL_TIRE = 0.38;

function makeWheel(tireMat: THREE.Material, hubMat: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const tireGeo = new THREE.CylinderGeometry(VISUAL_TIRE, VISUAL_TIRE, 0.24, 22);
  tireGeo.rotateZ(Math.PI / 2);
  const tire = new THREE.Mesh(tireGeo, tireMat);
  tire.castShadow = true;
  group.add(tire);
  const hubGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.32, 14);
  hubGeo.rotateZ(Math.PI / 2);
  const hub = new THREE.Mesh(hubGeo, hubMat);
  hub.name = 'hub';
  group.add(hub);
  for (let i = 0; i < 4; i++) {
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(VISUAL_TIRE + 0.008, VISUAL_TIRE + 0.008, 0.028, 16), tireMat);
    rib.rotation.z = Math.PI / 2;
    rib.position.x = -0.1 + i * 0.066;
    group.add(rib);
  }
  return group;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { AXLE };
