import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CARS, carById, type CarConfig } from './catalog';
import { Sfx } from './audio';
import { AXLE, ToyCar, type Detachable } from './carMesh';
import { Input } from './input';
import { Particles } from './particles';
import { DriveWorld, type ContactPoint, type DrivePose } from './physics';
import { initialQuality, stepDown, type Quality } from './quality';
import { SPAWN } from './terrain';
import { buildWorld, type WorldView } from './worldMesh';

export interface GameStats {
  ready: boolean;
  renderer: 'webgl2' | 'webgpu';
  fps: number;
  quality: string;
  carId: string;
  position: { x: number; y: number; z: number };
  speed: number;
  airborne: boolean;
  maxAirY: number;
  airTime: number;
  dents: number;
  partsDetached: number;
  impacted: boolean;
  maxImpact: number;
  stars: number;
  restarts: number;
  drawCalls: number;
  triangles: number;
}

const UP = new THREE.Vector3(0, 1, 0);

export class Game {
  readonly stats: GameStats = {
    ready: false,
    renderer: 'webgl2',
    fps: 60,
    quality: 'medium',
    carId: CARS[0].id,
    position: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z },
    speed: 0,
    airborne: false,
    maxAirY: SPAWN.y,
    airTime: 0,
    dents: 0,
    partsDetached: 0,
    impacted: false,
    maxImpact: 0,
    stars: 0,
    restarts: 0,
    drawCalls: 0,
    triangles: 0,
  };

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private sun!: THREE.DirectionalLight;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private useBloom = false;
  private quality: Quality = initialQuality();
  private drive!: DriveWorld;
  private car!: ToyCar;
  private worldView!: WorldView;
  private particles!: Particles;
  private readonly sfx = new Sfx();
  private readonly input: Input;
  private config: CarConfig = CARS[0];
  private loose: { mesh: THREE.Object3D; body: import('@dimforge/rapier3d-compat').RigidBody }[] = [];
  private last = 0;
  private accum = 0;
  private fpsSmooth = 60;
  private qualityTimer = 0;
  private dustTimer = 0;
  private stuck = 0;
  private snapCam = true;
  private crunchCooldown = 0;
  private readonly look = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly invQuat = new THREE.Quaternion();
  private readonly scratch = new THREE.Vector3();
  private readonly steerQ = new THREE.Quaternion();
  private readonly spinQ = new THREE.Quaternion();
  private readonly outward = new THREE.Vector3();
  private pose!: DrivePose;

  constructor() {
    this.input = new Input((id) => this.selectCar(id));
  }

  async start(): Promise<void> {
    const canvas = document.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing canvas');
    this.quality = initialQuality();
    this.stats.quality = this.quality.level;
    await this.makeRenderer(canvas, this.quality.antialias);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(this.quality.dpr);
    this.renderer.setClearColor(0xc5e8ff, 1);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xc5e8ff, 48, 210);
    this.scene.environmentIntensity = 0.92;
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.15, 500);
    this.camera.position.set(0, 4.5, -6);

    const hemi = new THREE.HemisphereLight(0xb7e4ff, 0x3e9a45, 0.55);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff4dd, 2.35);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.quality.shadowMap, this.quality.shadowMap);
    this.sun.shadow.camera.near = 4;
    this.sun.shadow.camera.far = 72;
    this.sun.shadow.camera.left = -16;
    this.sun.shadow.camera.right = 16;
    this.sun.shadow.camera.top = 16;
    this.sun.shadow.camera.bottom = -16;
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.045;
    this.scene.add(this.sun, this.sun.target);
    const fill = new THREE.DirectionalLight(0xcfe6ff, 0.4);
    fill.position.set(20, 12, -10);
    this.scene.add(fill);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());

    const [drive] = await Promise.all([DriveWorld.create(), this.loadEnvironment()]);
    this.drive = drive;
    this.worldView = buildWorld(this.scene);
    this.car = new ToyCar(this.config);
    this.scene.add(this.car.group);
    this.particles = new Particles(this.scene, this.quality.particles);
    this.setupBloom();
    this.input.attach(() => this.sfx.unlock());
    paintCarButtons();
    this.resize();

    document.getElementById('loading')?.classList.add('hidden');
    this.stats.ready = true;
    window.__game = this.stats;
    this.last = performance.now();
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  private async makeRenderer(canvas: HTMLCanvasElement, antialias: boolean): Promise<void> {
    const params = new URLSearchParams(location.search);
    const tryWebGPU = params.get('webgpu') === '1' || (!navigator.webdriver && 'gpu' in navigator);
    if (tryWebGPU) {
      try {
        const mod = await import('three/webgpu');
        const gpu = new mod.WebGPURenderer({ canvas, antialias, powerPreference: 'high-performance' });
        await gpu.init();
        this.renderer = gpu as unknown as THREE.WebGLRenderer;
        this.stats.renderer = 'webgpu';
        return;
      } catch (err) {
        console.info('WebGPU unavailable, using WebGL2', err);
      }
    }
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance', alpha: false });
    this.stats.renderer = 'webgl2';
  }

  private async loadEnvironment(): Promise<void> {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    try {
      const hdr = await new RGBELoader().loadAsync(`${import.meta.env.BASE_URL}hdri/kloofendal_puresky_1k.hdr`);
      this.scene.environment = pmrem.fromEquirectangular(hdr).texture;
      hdr.dispose();
    } catch (err) {
      console.info('HDRI fallback to procedural environment', err);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    }
    pmrem.dispose();
  }

  private setupBloom(): void {
    this.useBloom = this.stats.renderer === 'webgl2' && this.quality.bloom;
    if (!this.useBloom) return;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.14, 0.28, 0.94);
    this.composer.addPass(this.bloom);
    this.resize();
  }

  private frame(now: number): void {
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 1 / 60);
    this.last = now;
    this.fpsSmooth = this.fpsSmooth * 0.9 + (1 / Math.max(dt, 0.001)) * 0.1;
    this.stats.fps = Math.round(this.fpsSmooth);
    this.qualityTimer += dt;
    if (this.qualityTimer > 2.4 && this.fpsSmooth < 40) {
      this.qualityTimer = 0;
      this.applyQuality(stepDown(this.quality));
    }

    const command = this.input.sample();
    if (command.restart) this.restart();

    this.accum += dt;
    let steps = 0;
    let landed: {
      fallSpeed: number;
      airTime: number;
      contact: ContactPoint;
      x: number;
      y: number;
      z: number;
      qx: number;
      qy: number;
      qz: number;
      qw: number;
      vx: number;
      vy: number;
      vz: number;
    } | null = null;
    const extras: ContactPoint[] = [];
    while (this.accum >= 1 / 60 && steps < 5) {
      this.pose = this.drive.step(1 / 60, { throttle: command.throttle, steer: command.steer });
      if (this.pose.landed && this.pose.contact) {
        landed = {
          fallSpeed: this.pose.fallSpeed,
          airTime: this.pose.airTime,
          contact: { ...this.pose.contact },
          x: this.pose.x,
          y: this.pose.y,
          z: this.pose.z,
          qx: this.pose.qx,
          qy: this.pose.qy,
          qz: this.pose.qz,
          qw: this.pose.qw,
          vx: this.pose.vx,
          vy: this.pose.vy,
          vz: this.pose.vz,
        };
      }
      for (const hit of this.pose.extraHits) extras.push({ ...hit });
      this.accum -= 1 / 60;
      steps += 1;
    }
    if (!this.pose) return;

    this.syncCar(this.pose);
    this.syncLoose();
    this.followCamera(dt, this.pose);
    this.followSun(this.pose);
    this.worldView.update(dt);
    this.particles.update(dt);
    this.sfx.setEngine(this.pose.speed, command.throttle);
    this.publish(this.pose);
    this.watchStuck(dt, this.pose);

    if (landed) this.crunch(landed.contact, landed.fallSpeed, true, landed);
    for (const hit of extras) {
      if (this.crunchCooldown <= 0) this.crunch(hit, Math.min(12, hit.force / 900), false, this.pose);
    }
    this.refreshStars(this.pose);
    if (this.crunchCooldown > 0) this.crunchCooldown -= dt;

    this.dustTimer -= dt;
    if (this.dustTimer <= 0 && this.pose.wheelsOn > 0 && this.pose.speed > 6) {
      this.dustTimer = 0.07;
      const wheel = this.pose.wheels[2];
      this.scratch.set(wheel.x, wheel.y - 0.3, wheel.z).applyQuaternion(this.car.group.quaternion).add(this.car.group.position);
      this.particles.dustPuff(this.scratch.x, this.scratch.y, this.scratch.z, this.pose.speed);
    }

    if (this.useBloom && this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.stats.drawCalls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
  }

  private crunch(
    contact: ContactPoint,
    fallSpeed: number,
    celebrate: boolean,
    pose: { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number; vx: number; vy: number; vz: number },
  ): void {
    const strength = THREE.MathUtils.clamp((fallSpeed - 3) / 11, celebrate ? 0.42 : 0.2, 1);
    this.worldToCar(contact, this.scratch, pose);
    const local = this.scratch.clone();
    let moved = this.car.dent(local, strength);
    if (celebrate && moved < 8) moved += this.car.dent(new THREE.Vector3(0, -0.08, 0.85), Math.max(strength, 0.55));
    this.stats.dents += moved;
    this.stats.impacted = true;
    this.stats.maxImpact = Math.max(this.stats.maxImpact, fallSpeed);
    this.sfx.crunch(strength);
    if (strength < 0.7) this.sfx.boing();
    this.particles.sparksAt(contact.x, contact.y, contact.z, strength);

    const ranked = this.car.parts
      .filter((part) => !part.detached && fallSpeed + (celebrate ? 0.5 : 0) >= part.minSpeed)
      .sort((a, b) => a.localPos.distanceTo(local) - b.localPos.distanceTo(local));
    let popped = 0;
    for (const part of ranked) {
      if (this.stats.partsDetached >= 6 || popped >= (celebrate ? 4 : 1)) break;
      const dist = part.localPos.distanceTo(local);
      if (dist > part.radius) continue;
      this.detach(part, strength, pose);
      popped += 1;
    }

    if (celebrate) this.particles.celebrate(contact.x, contact.y + 0.6, contact.z);
    this.crunchCooldown = 0.22;
  }

  private detach(
    part: Detachable,
    strength: number,
    pose: { x: number; y: number; z: number; vx: number; vy: number; vz: number },
  ): void {
    part.mesh.updateWorldMatrix(true, true);
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    part.mesh.getWorldPosition(worldPos);
    part.mesh.getWorldQuaternion(worldQuat);
    this.outward.set(worldPos.x - pose.x, worldPos.y - pose.y, worldPos.z - pose.z);
    if (this.outward.lengthSq() < 1e-4) this.outward.set(0, 1, 0);
    this.outward.normalize();
    this.scene.attach(part.mesh);
    const body = this.drive.spawnDebris({
      position: {
        x: worldPos.x + this.outward.x * 0.18,
        y: worldPos.y + 0.12,
        z: worldPos.z + this.outward.z * 0.18,
      },
      rotation: { x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w },
      half: { x: part.half.x, y: part.half.y, z: part.half.z },
      ball: part.ball,
      velocity: {
        x: pose.vx + this.outward.x * (2.4 + strength * 3.2),
        y: pose.vy + 1.6 + strength * 2.4,
        z: pose.vz + this.outward.z * (2.4 + strength * 3.2),
      },
      spin: { x: (Math.random() - 0.5) * 9, y: (Math.random() - 0.5) * 9, z: (Math.random() - 0.5) * 9 },
    });
    if (part.wheelIndex !== undefined) this.drive.detachWheel(part.wheelIndex);
    part.detached = true;
    this.stats.partsDetached += 1;
    this.loose.push({ mesh: part.mesh, body });
    this.sfx.pop();
  }

  private restart(): void {
    for (const part of this.car.parts) {
      if (!part.detached) continue;
      this.car.group.attach(part.mesh);
      part.mesh.position.copy(part.localPos);
      part.mesh.quaternion.copy(part.localQuat);
      part.mesh.visible = true;
      part.detached = false;
    }
    this.loose = [];
    this.drive.reset();
    this.car.resetDamage();
    this.stats.dents = 0;
    this.stats.partsDetached = 0;
    this.stats.impacted = false;
    this.stats.maxImpact = 0;
    this.stats.stars = 0;
    this.stats.maxAirY = SPAWN.y;
    this.stats.airTime = 0;
    this.stats.restarts += 1;
    this.stuck = 0;
    this.snapCam = true;
    this.paintStars();
    this.sfx.boing();
    this.particles.celebrate(SPAWN.x, SPAWN.y + 1, SPAWN.z);
  }

  private selectCar(id: string): void {
    const next = carById(id);
    const changed = next.id !== this.config.id;
    this.config = next;
    this.stats.carId = next.id;
    this.car?.setConfig(next);
    document.querySelectorAll<HTMLElement>('[data-car]').forEach((button) => {
      button.classList.toggle('selected', button.dataset.car === next.id);
    });
    if (changed && this.drive && this.car) this.restart();
  }

  private syncCar(pose: DrivePose): void {
    this.car.group.position.set(pose.x, pose.y, pose.z);
    this.car.group.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
    for (let i = 0; i < 4; i++) {
      const part = this.car.parts.find((item) => item.wheelIndex === i);
      if (part?.detached) continue;
      const wheel = this.car.wheels[i];
      const sample = pose.wheels[i];
      wheel.position.set(sample.x, sample.y, sample.z);
      this.steerQ.setFromAxisAngle(UP, sample.steer);
      this.spinQ.setFromAxisAngle(AXLE, sample.spin);
      wheel.quaternion.multiplyQuaternions(this.steerQ, this.spinQ);
    }
  }

  private syncLoose(): void {
    for (const item of this.loose) {
      const t = item.body.translation();
      const x = t.x;
      const y = t.y;
      const z = t.z;
      const q = item.body.rotation();
      item.mesh.position.set(x, y, z);
      item.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
  }

  private followCamera(dt: number, pose: DrivePose): void {
    const yaw = Math.atan2(2 * (pose.qw * pose.qy + pose.qx * pose.qz), 1 - 2 * (pose.qy * pose.qy + pose.qz * pose.qz));
    const dist = 7.1;
    this.desired.set(pose.x - Math.sin(yaw) * dist, pose.y + 2.9, pose.z - Math.cos(yaw) * dist);
    this.lookTarget.set(pose.x + Math.sin(yaw) * 3.2, pose.y + 1.15, pose.z + Math.cos(yaw) * 3.2);
    if (this.snapCam) {
      this.camera.position.copy(this.desired);
      this.look.copy(this.lookTarget);
      this.snapCam = false;
    } else {
      const k = 1 - Math.exp(-dt * 3.1);
      this.camera.position.lerp(this.desired, k);
      this.look.lerp(this.lookTarget, k);
    }
    this.camera.lookAt(this.look);
    const fov = 58 + Math.min(pose.speed, 32) * 0.42;
    if (Math.abs(this.camera.fov - fov) > 0.25) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private followSun(pose: DrivePose): void {
    this.sun.position.set(pose.x - 18, pose.y + 30, pose.z + 8);
    this.sun.target.position.set(pose.x, pose.y, pose.z + 4);
    this.sun.target.updateMatrixWorld();
  }

  private publish(pose: DrivePose): void {
    this.stats.position.x = pose.x;
    this.stats.position.y = pose.y;
    this.stats.position.z = pose.z;
    this.stats.speed = pose.speed;
    this.stats.airborne = pose.airborne;
    this.stats.maxAirY = pose.maxAirY;
    this.stats.airTime = pose.airTime;
  }

  private refreshStars(pose: DrivePose): void {
    let stars = this.stats.stars;
    if (pose.maxAirY > 5) stars = Math.max(stars, 1);
    if (pose.airTime > 0.75 || (pose.airborne && pose.y > 8)) stars = Math.max(stars, 2);
    if (this.stats.impacted) stars = Math.max(stars, 3);
    if (this.stats.dents > 0 || this.stats.partsDetached > 0) stars = Math.max(stars, 4);
    if (pose.airTime > 1.4 || this.stats.partsDetached >= 2 || pose.maxAirY > 11) stars = Math.max(stars, 5);
    if (stars !== this.stats.stars) {
      const gained = stars > this.stats.stars;
      this.stats.stars = stars;
      this.paintStars();
      if (gained) this.sfx.chime();
    }
  }

  private watchStuck(dt: number, pose: DrivePose): void {
    const upright = 1 - 2 * (pose.qx * pose.qx + pose.qz * pose.qz);
    const belly = pose.wheelsOn === 0 && pose.speed < 0.7 && pose.y < 1.2 && !pose.airborne && pose.z > 8;
    const flipped = upright < 0.25 && pose.speed < 1.4 && !pose.airborne && pose.z > 8;
    if (belly || flipped) {
      this.stuck += dt;
      if (this.stuck > 1.7) this.restart();
    } else this.stuck = 0;
  }

  private worldToCar(
    point: ContactPoint,
    target: THREE.Vector3,
    pose: { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number } = this.pose,
  ): THREE.Vector3 {
    target.set(point.x - pose.x, point.y - pose.y, point.z - pose.z);
    this.invQuat.set(pose.qx, pose.qy, pose.qz, pose.qw).invert();
    target.applyQuaternion(this.invQuat);
    return target;
  }

  private paintStars(): void {
    document.querySelectorAll('#stars .star').forEach((el, index) => {
      el.classList.toggle('on', index < this.stats.stars);
    });
  }

  private applyQuality(next: Quality): void {
    if (next.dpr === this.quality.dpr && next.bloom === this.quality.bloom && next.shadowMap === this.quality.shadowMap) return;
    this.quality = next;
    this.stats.quality = next.level;
    this.useBloom = this.stats.renderer === 'webgl2' && next.bloom && !!this.composer;
    this.sun.shadow.mapSize.set(next.shadowMap, next.shadowMap);
    const map = this.sun.shadow.map;
    if (map) {
      map.dispose();
      this.sun.shadow.map = null;
    }
    this.resize();
  }

  private resize(): void {
    if (!this.renderer || !this.camera) return;
    const width = window.innerWidth;
    const height = Math.max(1, window.innerHeight);
    this.renderer.setPixelRatio(this.quality.dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.composer?.setPixelRatio(this.quality.dpr);
    this.composer?.setSize(width, height);
  }
}

function paintCarButtons(): void {
  for (const car of CARS) {
    const button = document.querySelector<HTMLElement>(`[data-car="${car.id}"]`);
    if (!button) continue;
    button.style.setProperty('--car', car.body);
    button.style.setProperty('--accent', car.accent);
  }
}

declare global {
  interface Window {
    __game?: GameStats;
  }
}
