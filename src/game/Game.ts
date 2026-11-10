import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CARS, carById, type CarConfig } from './catalog';
import { Sfx } from './audio';
import { AXLE, ToyCar, type Detachable } from './carMesh';
import { Input } from './input';
import { Particles } from './particles';
import { DriveWorld, type ContactPoint, type DrivePose } from './physics';
import { initialQuality, isIOS, stepDown, type Quality } from './quality';
import { driveSurfaceHeight, SPAWN } from './terrain';
import { HORIZON, SKY_TINT, SUN_DIR, buildWorld, type WorldView } from './worldMesh';

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
  dpr: number;
  assets: string;
  physics: string;
  boot: string;
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
    dpr: 1,
    assets: 'pending',
    physics: 'pending',
    boot: '',
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
  private slow = 0;
  private prevVy = 0;
  private wasAir = false;
  private shakeAmp = 0;
  private speedEl: HTMLElement | null = null;
  private contact: THREE.Mesh | null = null;
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
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setPixelRatio(this.quality.dpr);
    this.renderer.setClearColor(HORIZON, 1);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(HORIZON, 95, 260);
    this.scene.environmentIntensity = 0.72;
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.15, 500);
    this.camera.position.set(0, 4.5, -6);

    const hemi = new THREE.HemisphereLight(SKY_TINT, 0x6a7a3e, 0.42);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d4, 1.55);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.quality.shadowMap, this.quality.shadowMap);
    this.sun.shadow.camera.near = 4;
    this.sun.shadow.camera.far = 56;
    this.sun.shadow.camera.left = -12;
    this.sun.shadow.camera.right = 12;
    this.sun.shadow.camera.top = 12;
    this.sun.shadow.camera.bottom = -12;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    const fill = new THREE.DirectionalLight(0xcfe6ff, 0.4);
    fill.position.set(20, 12, -10);
    this.scene.add(fill);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());

    this.drive = await DriveWorld.create();
    if (this.drive.groundUnderSpawn()) {
      this.stats.physics = 'track';
    } else {
      this.drive.addSafetyFloor();
      this.stats.physics = this.drive.groundUnderSpawn() ? 'safety-floor' : 'no-ground';
    }
    this.drive.settle();
    try {
      this.worldView = await buildWorld(this.scene, this.renderer, {
        hiPano: this.quality.hiPano,
        treeCount: this.quality.treeCount,
        tuftCount: this.quality.level === 'high' ? 140 : this.quality.level === 'medium' ? 80 : 28,
        anisotropy: this.anisotropy(),
      });
      this.stats.assets = 'ok';
    } catch (err) {
      this.stats.assets = 'fallback';
      this.stats.boot = err instanceof Error ? err.message : String(err);
      console.info('Scene assets fell back', err);
      this.worldView = { update() {} };
      const pad = new THREE.Mesh(
        new THREE.PlaneGeometry(80, 200),
        new THREE.MeshStandardMaterial({ color: 0x3f9a45, roughness: 1 }),
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(0, 0, 60);
      pad.receiveShadow = true;
      this.scene.add(pad);
    }
    this.car = new ToyCar(this.config);
    this.scene.add(this.car.group);
    this.addContact();
    this.particles = new Particles(this.scene, this.quality.particles);
    this.setupBloom();
    this.input.attach(() => this.sfx.unlock());
    paintCarButtons();
    this.resize();

    document.getElementById('loading')?.classList.add('hidden');
    this.stats.ready = true;
    this.stats.dpr = this.quality.dpr;
    window.__game = this.stats;
    if (new URLSearchParams(location.search).get('debug') === '1') this.showDebug();
    window.addEventListener('touchstart', (event) => {
      if (event.touches.length >= 3) this.showDebug();
    }, { passive: true });
    this.paintDebug();
    this.last = performance.now();
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  private async makeRenderer(canvas: HTMLCanvasElement, antialias: boolean): Promise<void> {
    const params = new URLSearchParams(location.search);
    const forced = params.get('webgpu');
    // Real iPhones and iPads (including iPadOS desktop UA) stay on WebGL2 unless ?webgpu=1,
    // and only if the renderer actually exposes a working WebGL-compatible backend.
    const tryWebGPU = forced === '1' || (forced !== '0' && !isIOS() && !navigator.webdriver && 'gpu' in navigator);
    if (tryWebGPU) {
      try {
        const mod = await import('three/webgpu');
        const gpu = new mod.WebGPURenderer({ canvas, antialias, powerPreference: 'high-performance' });
        await gpu.init();
        if (!rendererUsable(gpu)) {
          gpu.dispose?.();
          throw new Error('WebGPU renderer has no usable capabilities');
        }
        this.renderer = gpu as unknown as THREE.WebGLRenderer;
        this.stats.renderer = 'webgpu';
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.stats.boot = `webgpu: ${message}`;
        console.info('WebGPU unavailable, using WebGL2', err);
      }
    }
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance', alpha: false });
    this.stats.renderer = 'webgl2';
  }

  private anisotropy(): number {
    try {
      const value = this.renderer.capabilities?.getMaxAnisotropy?.();
      return typeof value === 'number' ? value : 4;
    } catch {
      return 4;
    }
  }

  private setupBloom(): void {
    this.useBloom = this.stats.renderer === 'webgl2' && this.quality.bloom;
    if (!this.useBloom) return;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.16, 0.32, 0.9);
    this.composer.addPass(this.bloom);
    this.resize();
  }

  private frame(now: number): void {
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 1 / 60);
    this.last = now;
    this.fpsSmooth = this.fpsSmooth * 0.9 + (1 / Math.max(dt, 0.001)) * 0.1;
    this.stats.fps = Math.round(this.fpsSmooth);
    this.qualityTimer += dt;
    if (this.qualityTimer > 6 && this.fpsSmooth < 40) {
      this.qualityTimer = 0;
      this.applyQuality(stepDown(this.quality, this.fpsSmooth < 24));
    }

    const command = this.input.sample();
    if (command.restart) this.restart();

    const timeScale = this.slow > 0 ? 0.34 : 1;
    if (this.slow > 0) this.slow = Math.max(0, this.slow - dt);
    this.accum += dt * timeScale;
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

    if (this.pose.airborne && this.prevVy > 0.35 && this.pose.vy <= 0 && this.pose.y > 7.5) this.slow = 0.42;
    this.prevVy = this.pose.vy;
    if (this.pose.airborne && !this.wasAir && this.pose.speed > 9) this.sfx.whoosh();
    this.wasAir = this.pose.airborne;
    this.paintSpeed();

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
    this.paintDebug();
  }

  failBoot(err: unknown): void {
    this.stats.boot = err instanceof Error ? err.message : String(err);
    this.stats.assets = this.stats.assets === 'pending' ? 'failed' : this.stats.assets;
    this.showDebug();
    this.paintDebug();
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
    if (celebrate) {
      this.sfx.jingle();
      this.particles.dustBurst(contact.x, contact.y, contact.z);
      this.shakeAmp = Math.max(this.shakeAmp, 0.14 + strength * 0.32);
    } else if (strength > 0.35) {
      this.shakeAmp = Math.max(this.shakeAmp, strength * 0.16);
    }

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
    const air = pose.airborne ? 1 : 0;
    const dist = 7.3 + Math.min(pose.speed, 28) * 0.07 + air * 1.5;
    const height = 2.7 + Math.min(pose.speed, 28) * 0.02 + air * 0.7;
    const ahead = 3.3 + Math.min(pose.speed, 30) * 0.07;
    this.desired.set(pose.x - Math.sin(yaw) * dist, pose.y + height, pose.z - Math.cos(yaw) * dist);
    this.lookTarget.set(pose.x + Math.sin(yaw) * ahead, pose.y + 1.1, pose.z + Math.cos(yaw) * ahead);
    if (this.snapCam) {
      this.camera.position.copy(this.desired);
      this.look.copy(this.lookTarget);
      this.snapCam = false;
    } else {
      const k = 1 - Math.exp(-dt * 3.1);
      this.camera.position.lerp(this.desired, k);
      this.look.lerp(this.lookTarget, k);
    }
    if (this.shakeAmp > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmp;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmp * 0.55;
      this.shakeAmp = Math.max(0, this.shakeAmp - dt * 1.15);
    }
    const ground = driveSurfaceHeight(this.camera.position.z);
    if (ground !== null && this.camera.position.y < ground + 0.55) this.camera.position.y = ground + 0.55;
    this.camera.lookAt(this.look);
    this.placeContact(pose);
    const fov = 58 + Math.min(pose.speed, 32) * 0.42;
    if (Math.abs(this.camera.fov - fov) > 0.25) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private followSun(pose: DrivePose): void {
    this.sun.position.set(pose.x + SUN_DIR.x * 40, pose.y + SUN_DIR.y * 40, pose.z + SUN_DIR.z * 40);
    this.sun.target.position.set(pose.x, pose.y, pose.z);
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

  private showDebug(): void {
    document.getElementById('debug')?.classList.add('show');
  }

  private paintDebug(): void {
    const el = document.getElementById('debug');
    if (!el?.classList.contains('show')) return;
    const s = this.stats;
    el.textContent = [
      `renderer ${s.renderer}`,
      `fps ${s.fps}  dpr ${s.dpr}  ${s.quality}`,
      `assets ${s.assets}`,
      `physics ${s.physics}`,
      `y ${s.position.y.toFixed(2)}  z ${s.position.z.toFixed(1)}`,
      s.boot,
    ].filter(Boolean).join('\n');
  }

  private addContact(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const gradient = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(0,0,0,0.5)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const map = new THREE.CanvasTexture(canvas);
    this.contact = new THREE.Mesh(
      new THREE.PlaneGeometry(2.1, 2.4),
      new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, opacity: 0.42, toneMapped: true }),
    );
    this.contact.rotation.x = -Math.PI / 2;
    this.contact.renderOrder = 2;
    this.scene.add(this.contact);
  }

  private placeContact(pose: DrivePose): void {
    if (!this.contact) return;
    const ground = driveSurfaceHeight(pose.z);
    this.contact.visible = pose.wheelsOn > 0 && ground !== null;
    if (ground === null) return;
    this.contact.position.set(pose.x, ground + 0.035, pose.z);
  }

  private paintSpeed(): void {
    if (!this.speedEl) this.speedEl = document.getElementById('speed');
    if (!this.speedEl || !this.pose) return;
    const kick = this.quality.level === 'low' ? 0 : THREE.MathUtils.clamp((this.pose.speed - 11) / 22, 0, 1);
    this.speedEl.style.opacity = kick > 0.04 ? String(kick * 0.65) : '0';
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
    this.stats.dpr = this.quality.dpr;
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

function rendererUsable(renderer: { capabilities?: { getMaxAnisotropy?: () => number } }): boolean {
  try {
    return typeof renderer.capabilities?.getMaxAnisotropy?.() === 'number';
  } catch {
    return false;
  }
}

declare global {
  interface Window {
    __game?: GameStats;
  }
}
