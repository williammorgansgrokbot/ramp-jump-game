import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CARS, carById, type CarConfig } from './catalog';
import { Sfx } from './audio';
import { AXLE, ToyCar, type Detachable } from './carMesh';
import { COLOR_OF, type VehicleType } from './carFit';
import { Input } from './input';
import { Particles } from './particles';
import { DriveWorld, type ContactPoint, type DrivePose } from './physics';
import { initialQuality, isIOS, stepDown, type Quality } from './quality';
import { LOOP, stuntById, type StuntId } from './stunts';
import { driveSurfaceHeight, FIELD, SPAWN } from './terrain';
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
  stunt: string;
  looped: boolean;
  tricking: boolean;
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
    stunt: 'launch',
    looped: false,
    tricking: false,
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
  private vehicleType: VehicleType = 'car';
  private swapping = false;
  /** The pick already spoke, so the restart that follows it stays quiet. */
  private sayOnRestart = true;
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
  private trickSpark = 0;
  private invertTime = 0;
  private speedEl: HTMLElement | null = null;
  private contact: THREE.Mesh | null = null;
  private skid: THREE.Mesh | null = null;
  private skidPos: Float32Array | null = null;
  private skidCount = 0;
  private skidBreak = true;
  private skidHold = 0;
  private readonly skidSamples = 28;
  private readonly skidRight = new THREE.Vector3();
  private readonly skidRear = new THREE.Vector3();
  private readonly skidMid = new THREE.Vector3();
  private readonly skidL0 = new THREE.Vector3();
  private readonly skidL1 = new THREE.Vector3();
  private readonly skidR0 = new THREE.Vector3();
  private readonly skidR1 = new THREE.Vector3();
  private skidMarkX = Number.NaN;
  private skidMarkZ = Number.NaN;
  private readonly yawQ = new THREE.Quaternion();
  private readonly tiltQ = new THREE.Quaternion();
  private readonly look = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly invQuat = new THREE.Quaternion();
  private readonly scratch = new THREE.Vector3();
  private readonly steerQ = new THREE.Quaternion();
  private readonly spinQ = new THREE.Quaternion();
  private readonly outward = new THREE.Vector3();
  private pose!: DrivePose;
  private stuntId: StuntId = 'launch';
  private stuntBase = SPAWN.y;
  private camMode: 'chase' | 'face' | 'side' = 'chase';
  private camHold = false;

  constructor() {
    const saved = readPick();
    this.vehicleType = saved.type;
    this.config = carById(saved.id);
    this.stats.carId = `${saved.type}:${saved.id}`;
    this.input = new Input((id) => this.selectCar(id), (id) => this.selectStunt(id), (type) => this.selectType(type));
  }

  async start(): Promise<void> {
    const canvas = document.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing canvas');
    this.quality = initialQuality();
    this.stats.quality = this.quality.level;
    await this.makeRenderer(canvas, this.quality.antialias);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.quality.level === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.setPixelRatio(this.quality.dpr);
    this.renderer.setClearColor(HORIZON, 1);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(HORIZON, 150, 480);
    this.scene.environmentIntensity = 0.55;
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.15, 500);
    this.camera.position.set(0, 4.5, -6);

    const hemi = new THREE.HemisphereLight(SKY_TINT, 0xcbb892, 0.66);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d4, 1.16);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.quality.shadowMap, this.quality.shadowMap);
    this.sun.shadow.camera.near = 4;
    this.sun.shadow.camera.far = 56;
    this.sun.shadow.camera.left = -14;
    this.sun.shadow.camera.right = 14;
    this.sun.shadow.camera.top = 14;
    this.sun.shadow.camera.bottom = -14;
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.08;
    this.sun.shadow.radius = 2.5;
    this.scene.add(this.sun, this.sun.target);

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
        hiTex: this.quality.level === 'high',
        treeCount: this.quality.treeCount,
        propLevel: this.quality.level,
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
    this.car = await ToyCar.create({
      base: import.meta.env.BASE_URL,
      mobile: this.quality.level !== 'high',
      anisotropy: this.anisotropy(),
      type: this.vehicleType,
      id: this.config.id,
    });
    this.drive.fitVehicle(this.vehicleType, this.car.axles());
    this.drive.settle();
    this.scene.add(this.car.group);
    this.addContact();
    this.addSkid();
    this.particles = new Particles(this.scene, this.quality.particles);
    this.setupBloom();
    this.input.attach(() => this.sfx.unlock());
    paintGarage(this.vehicleType, this.config.id);
    this.resize();

    document.getElementById('loading')?.classList.add('hidden');
    cheer(this.config.name);
    this.stats.ready = true;
    this.stats.dpr = this.quality.dpr;
    window.__game = this.stats;
    window.__frame = (mode: string) => {
      this.camHold = false;
      this.camMode = mode === 'face' || mode === 'side' ? mode : 'chase';
      this.snapCam = true;
    };
    window.__look = (px: number, py: number, pz: number, lx: number, ly: number, lz: number) => {
      this.camHold = true;
      this.camera.position.set(px, py, pz);
      this.look.set(lx, ly, lz);
      this.camera.lookAt(this.look);
    };
    window.__loop = {
      laneX: LOOP.laneX,
      entryZ: LOOP.entryZ,
      exitZ: LOOP.exitZ,
      exitX: LOOP.exitX,
      midZ: LOOP.midZ,
      height: LOOP.height,
    };
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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.05, 0.2, 0.98);
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
    let trickEdge = command.trick;
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
    let boosted = false;
    while (this.accum >= 1 / 60 && steps < 5) {
      this.pose = this.drive.step(1 / 60, { throttle: command.throttle, steer: command.steer, trick: trickEdge });
      trickEdge = false;
      if (this.pose.boosted) boosted = true;
      if (this.pose.hopped) this.sfx.boing();
      if (this.pose.spun) {
        this.sfx.yay();
        this.particles.celebrate(this.pose.x, this.pose.y + 1, this.pose.z);
      }
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
    if (boosted) {
      this.particles.smokeBurst(this.pose.x, this.pose.y + 0.25, this.pose.z);
      this.shakeAmp = Math.max(this.shakeAmp, 0.03);
    }
    if (landed) this.skidHold = Math.max(this.skidHold, 0.28);
    this.skidHold = Math.max(0, this.skidHold - dt);
    this.paintSkid(this.pose);

    if (this.pose.tricking) {
      this.trickSpark += dt;
      if (this.trickSpark > 0.12) {
        this.trickSpark = 0;
        this.particles.sparksAt(this.pose.x, this.pose.y + 0.8, this.pose.z, 0.35);
      }
    }
    if (this.pose.trickLanded) {
      this.stats.stars = Math.min(5, this.stats.stars + 1);
      this.paintStars();
      this.sfx.chime();
      this.particles.celebrate(this.pose.x, this.pose.y + 1.2, this.pose.z);
    }
    this.syncCar(this.pose);
    this.car.updateFace(dt, {
      steer: command.steer,
      airborne: this.pose.airborne,
      vy: this.pose.vy,
      crash: false,
    });
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
    if (celebrate && moved < 8) moved += this.car.dent(new THREE.Vector3(0, -0.25, 1.15), Math.max(strength, 0.55));
    this.stats.dents += moved;
    this.stats.impacted = true;
    this.stats.maxImpact = Math.max(this.stats.maxImpact, fallSpeed);
    this.car.updateFace(0, { steer: 0, airborne: false, vy: 0, crash: true });
    this.sfx.crunch(strength);
    if (strength < 0.7) this.sfx.boing();
    this.particles.sparksAt(contact.x, contact.y, contact.z, strength);
    if (celebrate) {
      this.sfx.jingle();
      this.particles.dustBurst(contact.x, contact.y, contact.z);
      this.particles.smokeBurst(contact.x, contact.y + 0.4, contact.z);
      this.shakeAmp = Math.max(this.shakeAmp, 0.035 + strength * 0.06);
    } else if (strength > 0.35) {
      this.shakeAmp = Math.max(this.shakeAmp, strength * 0.03);
    }

    const ranked = this.car.parts
      .filter((part) => part.wheelIndex === undefined && !part.detached && fallSpeed + (celebrate ? 0.5 : 0) >= part.minSpeed)
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
    this.drive.reset(this.stuntId);
    this.drive.settle();
    this.invertTime = 0;
    this.stuck = 0;
    this.car.resetDamage();
    const spawn = stuntById(this.stuntId).spawn;
    this.stuntBase = spawn.y;
    this.stats.dents = 0;
    this.stats.partsDetached = 0;
    this.stats.impacted = false;
    this.stats.maxImpact = 0;
    this.stats.stars = 0;
    this.stats.looped = false;
    this.stats.stunt = this.stuntId;
    this.stats.maxAirY = spawn.y;
    this.stats.airTime = 0;
    this.stats.restarts += 1;
    this.stuck = 0;
    this.snapCam = true;
    this.paintStars();
    this.sfx.boing();
    this.particles.celebrate(spawn.x, spawn.y + 1, spawn.z);
    if (this.sayOnRestart) cheer(this.config.name);
    this.sayOnRestart = true;
  }

  private selectStunt(id: string): void {
    const next = stuntById(id);
    this.stuntId = next.id;
    this.stats.stunt = next.id;
    document.querySelectorAll<HTMLElement>('[data-stunt]').forEach((button) => {
      button.classList.toggle('selected', button.dataset.stunt === next.id);
    });
    if (this.drive && this.car) this.restart();
  }

  private selectType(type: string): void {
    if (type !== 'car' && type !== 'jeep' && type !== 'monster') return;
    if (type === this.vehicleType || this.swapping) return;
    this.vehicleType = type;
    cheer(this.config.name);
    this.sayOnRestart = false;
    void this.applyPick();
  }

  private selectCar(id: string): void {
    if (id === this.config.id || this.swapping) return;
    this.config = carById(id);
    showNameSplash(this.config.name, this.config.body);
    cheer(this.config.name);
    this.sayOnRestart = false;
    void this.applyPick();
  }

  private async applyPick(): Promise<void> {
    if (!this.car || !this.drive) return;
    this.swapping = true;
    const type = this.vehicleType;
    const id = this.config.id;
    try {
      await this.car.show(type, id);
      this.drive.fitVehicle(type, this.car.axles());
      this.stats.carId = `${type}:${id}`;
      writePick(type, id);
      paintGarage(type, id);
      this.restart();
    } catch (err) {
      console.info('Vehicle swap failed', err);
    } finally {
      this.swapping = false;
    }
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
    if (this.camHold) return;
    const yaw = Math.atan2(2 * (pose.qw * pose.qy + pose.qx * pose.qz), 1 - 2 * (pose.qy * pose.qy + pose.qz * pose.qz));
    if (this.camMode === 'face') {
      this.desired.set(pose.x + Math.cos(yaw) * 2.2 + Math.sin(yaw) * 5.6, pose.y + 0.45, pose.z - Math.sin(yaw) * 2.2 + Math.cos(yaw) * 5.6);
      this.lookTarget.set(pose.x, pose.y - 0.15, pose.z + Math.cos(yaw) * 0.4);
    } else if (this.camMode === 'side') {
      this.desired.set(pose.x + Math.cos(yaw) * 6.4, pose.y + 0.35, pose.z - Math.sin(yaw) * 6.4);
      this.lookTarget.set(pose.x, pose.y - 0.25, pose.z);
    } else {
    const air = pose.airborne ? 1 : 0;
    const tall = this.drive.tireDrop() > 1.15;
    const dist = (tall ? 18.6 : 16.2) + Math.min(pose.speed, 28) * 0.09 + air * 2.4;
    const height = (tall ? 12.8 : 11.1) + Math.min(pose.speed, 28) * 0.035 + air * 1.6;
    const ahead = 5.4 + Math.min(pose.speed, 30) * 0.06;
    const lookY = tall ? 1.05 : 0.7;
    this.desired.set(pose.x - Math.sin(yaw) * dist, pose.y + height, pose.z - Math.cos(yaw) * dist);
    this.lookTarget.set(pose.x + Math.sin(yaw) * ahead, pose.y + lookY, pose.z + Math.cos(yaw) * ahead);
    }
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
    const deck = driveSurfaceHeight(this.camera.position.z, this.camera.position.x);
    const surface = deck === null ? FIELD.floorY : Math.max(deck, FIELD.floorY);
    const minY = surface + 0.9;
    if (this.camera.position.y < minY) this.camera.position.y = minY;
    if (this.look.y < surface + 0.4) this.look.y = surface + 0.4;
    this.camera.lookAt(this.look);
    this.placeContact(pose);
    const fov = (this.camera.aspect < 1 ? 66 : 58) + Math.min(pose.speed, 32) * 0.32;
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
    this.stats.looped = pose.looped;
    this.stats.tricking = pose.tricking;
    this.stats.stunt = pose.stunt;
  }

  private refreshStars(pose: DrivePose): void {
    const air = pose.maxAirY - (this.stuntBase - SPAWN.y);
    let stars = this.stats.stars;
    if (air > 5) stars = Math.max(stars, 1);
    if (pose.airTime > 0.75 || (pose.airborne && pose.y > 8)) stars = Math.max(stars, 2);
    if (this.stats.impacted) stars = Math.max(stars, 3);
    if (this.stats.dents > 0 || this.stats.partsDetached > 0) stars = Math.max(stars, 4);
    if (pose.airTime > 1.4 || this.stats.partsDetached >= 2 || air > 11) stars = Math.max(stars, 5);
    if (stars !== this.stats.stars) {
      const gained = stars > this.stats.stars;
      this.stats.stars = stars;
      this.paintStars();
      if (gained) this.sfx.chime();
    }
  }

  private watchStuck(dt: number, pose: DrivePose): void {
    if (pose.rescue) {
      this.restart();
      return;
    }
    const upright = 1 - 2 * (pose.qx * pose.qx + pose.qz * pose.qz);
    const guided = this.drive.isLooping();
    if (upright < 0.2 && !guided) this.invertTime += dt;
    else this.invertTime = 0;
    if (this.invertTime > 2) {
      this.restart();
      return;
    }
    const belly = pose.wheelsOn === 0 && pose.speed < 0.7 && pose.y < 1.2 && !pose.airborne && pose.z > 8 && !guided;
    if (belly) {
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
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const gradient = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(0,0,0,0.5)');
    gradient.addColorStop(0.32, 'rgba(0,0,0,0.26)');
    gradient.addColorStop(0.68, 'rgba(0,0,0,0.08)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const map = new THREE.CanvasTexture(canvas);
    this.contact = new THREE.Mesh(
      new THREE.PlaneGeometry(3.3, 4.8),
      new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, opacity: 0.36, toneMapped: false }),
    );
    this.contact.renderOrder = 2;
    this.tiltQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    this.scene.add(this.contact);
  }

  private addSkid(): void {
    const samples = this.skidSamples;
    this.skidPos = new Float32Array(samples * 12);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.skidPos, 3));
    const index: number[] = [];
    for (let i = 0; i < samples - 1; i++) {
      const a = i * 4;
      const b = a + 4;
      index.push(a, a + 1, b, b, a + 1, b + 1);
      index.push(a + 2, a + 3, b + 2, b + 2, a + 3, b + 3);
    }
    geo.setIndex(index);
    geo.setDrawRange(0, 0);
    this.skid = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: 0x1a1a1a,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.skid.frustumCulled = false;
    this.skid.renderOrder = 1;
    this.scene.add(this.skid);
  }

  private paintSkid(pose: DrivePose): void {
    if (!this.skid || !this.skidPos) return;
    const steer = pose.wheels[0]?.steer ?? 0;
    const sliding = pose.wheelsOn >= 2 && !pose.airborne && (this.skidHold > 0 || (pose.speed > 7 && Math.abs(steer) > 0.22));
    if (!sliding) {
      this.skidBreak = true;
      this.skidMarkX = Number.NaN;
      return;
    }
    const track = this.vehicleType === 'monster' ? 1.05 : this.vehicleType === 'jeep' ? 0.86 : 0.78;
    const half = this.vehicleType === 'monster' ? 0.34 : 0.16;
    const moved = this.skidMarkX - pose.x;
    const movedZ = this.skidMarkZ - pose.z;
    if (!this.skidBreak && moved * moved + movedZ * movedZ < 0.45 * 0.45) return;
    this.yawQ.set(pose.qx, pose.qy, pose.qz, pose.qw);
    this.skidRight.set(1, 0, 0).applyQuaternion(this.yawQ);
    this.skidRear.set(0, 0, -1.05).applyQuaternion(this.yawQ);
    this.skidMid.set(pose.x, pose.y, pose.z).add(this.skidRear);
    const yL = (driveSurfaceHeight(this.skidMid.z + this.skidRight.z * track, this.skidMid.x + this.skidRight.x * track) ?? pose.y - 1) + 0.04;
    const yR = (driveSurfaceHeight(this.skidMid.z - this.skidRight.z * track, this.skidMid.x - this.skidRight.x * track) ?? pose.y - 1) + 0.04;
    this.skidL0.copy(this.skidMid).addScaledVector(this.skidRight, track + half);
    this.skidL1.copy(this.skidMid).addScaledVector(this.skidRight, track - half);
    this.skidR0.copy(this.skidMid).addScaledVector(this.skidRight, -track + half);
    this.skidR1.copy(this.skidMid).addScaledVector(this.skidRight, -track - half);
    this.skidL0.y = yL;
    this.skidL1.y = yL;
    this.skidR0.y = yR;
    this.skidR1.y = yR;
    this.skidMarkX = pose.x;
    this.skidMarkZ = pose.z;
    this.pushSkid(this.skidL0, this.skidL1, this.skidR0, this.skidR1);
  }

  private pushSkid(l0: THREE.Vector3, l1: THREE.Vector3, r0: THREE.Vector3, r1: THREE.Vector3): void {
    if (!this.skid || !this.skidPos) return;
    const samples = this.skidSamples;
    const write = (index: number, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
      const o = index * 12;
      const put = (slot: number, p: THREE.Vector3) => {
        this.skidPos![o + slot * 3] = p.x;
        this.skidPos![o + slot * 3 + 1] = p.y;
        this.skidPos![o + slot * 3 + 2] = p.z;
      };
      put(0, a);
      put(1, b);
      put(2, c);
      put(3, d);
    };
    if (this.skidCount >= samples) {
      this.skidPos.copyWithin(0, 12);
      this.skidCount = samples - 1;
    }
    if (this.skidBreak && this.skidCount > 0) {
      const prev = (this.skidCount - 1) * 12;
      this.skidPos.copyWithin(this.skidCount * 12, prev, prev + 12);
      this.skidCount += 1;
      if (this.skidCount >= samples) {
        this.skidPos.copyWithin(0, 12);
        this.skidCount = samples - 1;
      }
    }
    write(this.skidCount, l0, l1, r0, r1);
    this.skidCount += 1;
    this.skidBreak = false;
    const attr = this.skid.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.skid.geometry.setDrawRange(0, Math.max(0, (this.skidCount - 1) * 12));
  }

  private placeContact(pose: DrivePose): void {
    if (!this.contact) return;
    const ground = driveSurfaceHeight(pose.z, pose.x);
    const airFade = pose.airborne ? Math.max(0, 1 - pose.airTime * 1.1) : 1;
    this.contact.visible = ground !== null && airFade > 0.04;
    const mat = this.contact.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.4 * airFade;
    if (ground === null) return;
    const wide = this.vehicleType === 'monster' ? 1.42 : this.vehicleType === 'jeep' ? 1.16 : 1;
    this.contact.scale.set(wide, wide * 1.08, 1);
    this.contact.position.set(pose.x, ground + 0.045, pose.z);
    const yaw = Math.atan2(2 * (pose.qw * pose.qy + pose.qx * pose.qz), 1 - 2 * (pose.qy * pose.qy + pose.qz * pose.qz));
    this.yawQ.setFromAxisAngle(UP, yaw);
    this.contact.quaternion.copy(this.yawQ).multiply(this.tiltQ);
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

const PICK_KEY = 'ramp-vehicle';

function readPick(): { type: VehicleType; id: string } {
  try {
    const raw = localStorage.getItem(PICK_KEY);
    if (!raw) return { type: 'car', id: 'boy1' };
    const parsed = JSON.parse(raw) as { type?: string; id?: string };
    const type: VehicleType = parsed.type === 'jeep' || parsed.type === 'monster' ? parsed.type : 'car';
    const id = CARS.some((car) => car.id === parsed.id) ? parsed.id! : 'boy1';
    return { type, id };
  } catch {
    return { type: 'car', id: 'boy1' };
  }
}

function writePick(type: VehicleType, id: string): void {
  try {
    localStorage.setItem(PICK_KEY, JSON.stringify({ type, id }));
  } catch {
    /* private mode */
  }
}

function cheer(name: string): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    synth.cancel();
    const line = new SpeechSynthesisUtterance(`Go, ${name}!`);
    line.rate = 1.02;
    line.pitch = 1.18;
    synth.speak(line);
  } catch {
    /* Speech is optional. Older WebKit builds omit it. */
  }
}

function showNameSplash(name: string, color: string): void {
  const el = document.getElementById('name-splash');
  if (!el) return;
  const pill = document.createElement('span');
  pill.textContent = `${name}!`;
  pill.style.background = color;
  pill.style.color = color.toLowerCase() === '#ffd60a' ? '#3a2a08' : '#fffdf8';
  el.replaceChildren(pill);
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

function paintGarage(type: VehicleType, id: string): void {
  document.querySelectorAll<HTMLElement>('[data-type]').forEach((button) => {
    button.classList.toggle('selected', button.dataset.type === type);
  });
  for (const car of CARS) {
    const button = document.querySelector<HTMLButtonElement>(`[data-car="${car.id}"]`);
    const img = button?.querySelector('img');
    const color = COLOR_OF[car.id] ?? 'red';
    if (img) img.src = `art/thumbs/thumb_${type}_${color}_512.png`;
    button?.classList.toggle('selected', car.id === id);
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
    __frame?: (mode: string) => void;
    __look?: (px: number, py: number, pz: number, lx: number, ly: number, lz: number) => void;
    __loop?: { laneX: number; entryZ: number; exitZ: number; exitX: number; midZ: number; height: number };
  }
}
