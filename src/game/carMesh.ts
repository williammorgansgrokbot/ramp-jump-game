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
    this.addEyes();
    this.addChrome();
    this.addLights();
    this.paintPlate(config);
    this.addPlate(0, 0.78, -0.02, 0.5, 0.22);
    this.addSmile();

    this.part('hood', blister(0.62, 0.1, 0.38, this.bodyMat), new THREE.Vector3(0, 0.46, 0.62), 9, 1.6);
    this.part('trunk', blister(1.05, 0.18, 0.48, this.bodyMat), new THREE.Vector3(0, 0.42, -0.82), 11, 1.5);
    this.part('bumper-front', bumper(true), new THREE.Vector3(0, 0.14, 1.08), 6, 1.5);
    this.part('bumper-rear', bumper(false), new THREE.Vector3(0, 0.1, -1.16), 8, 1.45);
    this.part('door-left', blister(0.16, 0.32, 0.62, this.bodyMat), new THREE.Vector3(-0.7, 0.28, 0.02), 12, 1.3);
    this.part('door-right', blister(0.16, 0.32, 0.62, this.bodyMat), new THREE.Vector3(0.7, 0.28, 0.02), 12, 1.3);
    this.part('spoiler', this.spoiler(), new THREE.Vector3(0, 0.62, -1.02), 7, 1.7);
    this.part('antenna', this.antenna(), new THREE.Vector3(0.28, 0.95, -0.35), 4, 2.4);

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
      if (lid) lid.rotation.x = -1.15 + lidClose * 1.05;
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

  private addSmile(): void {
    const smile = new THREE.Mesh(
      new THREE.TorusGeometry(0.1, 0.022, 8, 14, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0xfff8f4, roughness: 0.25 }),
    );
    smile.position.set(0, 0.22, 1.18);
    this.group.add(smile);
  }

  private addCabin(): void {
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xe7f7ff,
      roughness: 0.04,
      metalness: 0,
      transparent: true,
      opacity: 0.38,
      envMapIntensity: 1.5,
      depthWrite: false,
    });
    const cabin = new THREE.Mesh(new THREE.SphereGeometry(0.52, 24, 16), glass);
    cabin.scale.set(1.2, 0.78, 1.25);
    cabin.position.set(0, 0.5, 0.02);
    this.group.add(cabin);
  }

  private addEyes(): void {
    const white = new THREE.MeshStandardMaterial({ color: 0xfffdf8, roughness: 0.28 });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.35 });
    const glintMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4 });
    for (const x of [-0.22, 0.22]) {
      const root = new THREE.Group();
      root.position.set(x, 0.64, 0.48);
      const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 14), white);
      sclera.scale.set(1.05, 1.22, 0.78);
      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 12), this.irisMat);
      iris.position.z = 0.07;
      iris.scale.z = 0.55;
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10), pupilMat);
      pupil.position.z = 0.1;
      pupil.scale.z = 0.5;
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), glintMat);
      glint.position.set(0.03, 0.04, 0.12);
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), this.lidMat);
      lid.scale.set(1.05, 0.7, 0.55);
      lid.position.set(0, 0.06, 0.02);
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
      const sill = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 1.15, 4, 8), chrome);
      sill.rotation.x = Math.PI / 2;
      sill.position.set(x * 0.62, 0.12, 0.05);
      this.group.add(sill);
    }
  }

  private addLights(): void {
    const head = new THREE.MeshStandardMaterial({
      color: 0xfff6d2,
      emissive: 0xfff1c2,
      emissiveIntensity: 1.15,
      roughness: 0.25,
    });
    const tail = new THREE.MeshStandardMaterial({
      color: 0xff2d2d,
      emissive: 0xff1d1d,
      emissiveIntensity: 0.7,
      roughness: 0.3,
    });
    for (const x of [-0.46, 0.46]) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 12), head);
      lamp.scale.set(1.05, 0.7, 0.45);
      lamp.position.set(x, 0.28, 1.02);
      this.group.add(lamp);
      const rear = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.05), tail);
      rear.position.set(x, 0.14, -1.2);
      this.group.add(rear);
    }
  }

  private spoiler(): THREE.Object3D {
    const group = new THREE.Group();
    const wing = new THREE.Mesh(new RoundedBoxGeometry(1.28, 0.06, 0.28, 2, 0.03), this.accentMat);
    wing.position.y = 0.16;
    wing.castShadow = true;
    group.add(wing);
    const strutMat = new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.4, metalness: 0.3 });
    for (const x of [-0.38, 0.38]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.08), strutMat);
      strut.position.set(x, 0.04, 0);
      group.add(strut);
    }
    return group;
  }

  private antenna(): THREE.Object3D {
    const group = new THREE.Group();
    const stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.42, 6),
      new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4 }),
    );
    stick.position.y = 0.1;
    group.add(stick);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), this.accentMat);
    ball.position.y = 0.34;
    group.add(ball);
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

function bumper(front: boolean): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.055, 8, 14, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.4, metalness: 0.35 }),
  );
  mesh.rotation.x = Math.PI / 2;
  if (front) {
    const smile = new THREE.Mesh(
      new THREE.TorusGeometry(0.11, 0.026, 8, 12, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0xfff8f4, roughness: 0.28 }),
    );
    smile.rotation.x = Math.PI;
    smile.position.set(0, 0.16, 0.04);
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

/** Smooth sports-car shell: lofted squircle sections, with fenders over the wheels. */
function sculptShell(): THREE.BufferGeometry {
  const stations: Array<[number, number, number, number]> = [
    [-1.28, 0.32, 0.1, 0.3],
    [-1.05, 0.58, 0.02, 0.46],
    [-0.78, 0.72, -0.04, 0.52],
    [-0.4, 0.64, 0.08, 0.8],
    [0.05, 0.62, 0.1, 0.86],
    [0.4, 0.66, 0.04, 0.6],
    [0.74, 0.74, -0.02, 0.46],
    [1.05, 0.52, 0.06, 0.34],
    [1.34, 0.26, 0.12, 0.26],
  ];
  const zCount = 26;
  const aCount = 18;
  const positions: number[] = [];
  const sample = (z: number) => {
    let i = 0;
    while (i < stations.length - 2 && z > stations[i + 1][0]) i += 1;
    const a = stations[i];
    const b = stations[i + 1];
    const t = Math.min(1, Math.max(0, (z - a[0]) / (b[0] - a[0] || 1)));
    const s = t * t * (3 - 2 * t);
    return {
      hw: a[1] + (b[1] - a[1]) * s,
      y0: a[2] + (b[2] - a[2]) * s,
      y1: a[3] + (b[3] - a[3]) * s,
    };
  };
  for (let iz = 0; iz <= zCount; iz++) {
    const z = -1.28 + (iz / zCount) * 2.62;
    const { hw, y0, y1 } = sample(z);
    const mid = (y0 + y1) / 2;
    const halfH = (y1 - y0) / 2;
    for (let ia = 0; ia <= aCount; ia++) {
      const ang = (ia / aCount) * Math.PI * 2;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const p = 2.35;
      const sx = Math.sign(s) * Math.abs(s) ** (2 / p);
      const sy = Math.sign(c) * Math.abs(c) ** (2 / p);
      let x = sx * hw;
      let y = mid + sy * halfH;
      const side = Math.abs(s) ** 1.3;
      const fender = Math.exp(-((z - 0.74) ** 2) / 0.08) + Math.exp(-((z + 0.8) ** 2) / 0.09);
      x += Math.sign(s || 1) * fender * side * 0.08;
      y -= fender * side * 0.22;
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
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const VISUAL_TIRE = 0.38;

function makeWheel(tireMat: THREE.Material, hubMat: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const tireGeo = new THREE.CylinderGeometry(VISUAL_TIRE, VISUAL_TIRE, 0.3, 20);
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
