import RAPIER from '@dimforge/rapier3d-compat';
import { BOOSTS, LOOP, QUARTER, loopPose, loopRibbon, quarterRibbon, laneCenter, stuntById, type StuntId } from './stunts';
import { axlesFor, restLength, vehicleSpec, type Axle, type VehicleSpec, type VehicleType } from './carFit';
import { barrierBoxes, driveSurfaceHeight, FIELD, quatPitch, SPAWN, trackFields } from './terrain';

const GROUP_CAR = 0x0001;
const GROUP_WORLD = 0x0002;
const GROUP_DEBRIS = 0x0004;

function mask(membership: number, filter: number): number {
  return (membership & 0xffff) | ((filter & 0xffff) << 16);
}

export interface DriveInput {
  /** 0..1 hold-to-drive. */
  throttle: number;
  /** -1 left, +1 right, from the chase camera behind the vehicle. */
  steer: number;
  /** One-shot hop on the ground, or a spin once the vehicle is in the air. */
  trick?: boolean;
}

export interface WheelPose {
  x: number;
  y: number;
  z: number;
  steer: number;
  spin: number;
  grounded: boolean;
  radius: number;
}

export interface ContactPoint {
  x: number;
  y: number;
  z: number;
  force: number;
}

export interface DrivePose {
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
  speed: number;
  wheelsOn: number;
  airborne: boolean;
  airTime: number;
  maxAirY: number;
  landed: boolean;
  fallSpeed: number;
  contact: ContactPoint | null;
  wheels: WheelPose[];
  /** Hard hits during the crumple window after a jump, besides the landing itself. */
  extraHits: ContactPoint[];
  looped: boolean;
  stunt: StuntId;
  /** This step drove over a boost pad. */
  boosted: boolean;
  /** A spin is playing. */
  tricking: boolean;
  /** This step began a hop. */
  hopped: boolean;
  /** This step began an air trick. */
  spun: boolean;
  /** Landed upright after a finished trick. */
  trickLanded: boolean;
  /** The car fell through the world or left the field. The game should respawn it. */
  rescue: boolean;
}

export interface DebrisBody {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

const DEFAULT_AXLES = axlesFor('car', 'boy1');
/**
 * Raycast car + static track. No Three.js imports so a Node sim can drive it.
 * Rapier's forward-axis setter is literally named `setIndexForwardAxis`.
 */
export class DriveWorld {
  readonly world: RAPIER.World;
  readonly queue: RAPIER.EventQueue;
  readonly chassis: RAPIER.RigidBody;
  readonly vehicle: RAPIER.DynamicRayCastVehicleController;
  readonly chassisColliders: RAPIER.Collider[] = [];
  readonly debris: DebrisBody[] = [];

  private axles: Axle[] = DEFAULT_AXLES.map((axle) => ({ ...axle }));
  private spec: VehicleSpec = vehicleSpec('car');
  private hull: RAPIER.Collider | null = null;
  private readonly chassisHandles = new Set<number>();
  private readonly hiddenWheels = new Set<number>();
  private steerAngle = 0;
  private hopCool = 0;
  private trickActive = false;
  private trickTime = 0;
  private trickDur = 0.8;
  private trickKind: 'roll' | 'yaw' = 'roll';
  private trickDir = 1;
  private trickYaw = 0;
  private trickAward = false;
  private seenGround = false;
  private wasAirborne = false;
  private airTime = 0;
  private maxAirY = SPAWN.y;
  private peakFall = 0;
  private crumpleWindow = 0;
  private readonly pose: DrivePose = {
    x: SPAWN.x,
    y: SPAWN.y,
    z: SPAWN.z,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    vx: 0,
    vy: 0,
    vz: 0,
    speed: 0,
    wheelsOn: 0,
    airborne: false,
    airTime: 0,
    maxAirY: SPAWN.y,
    landed: false,
    fallSpeed: 0,
    contact: null,
    wheels: DEFAULT_AXLES.map((axle) => ({ x: axle.x, y: axle.radius - 1, z: axle.z, steer: 0, spin: 0, grounded: false, radius: axle.radius })),
    extraHits: [],
    looped: false,
    stunt: 'launch',
    boosted: false,
    tricking: false,
    hopped: false,
    spun: false,
    trickLanded: false,
    rescue: false,
  };

  private stuntId: StuntId = 'launch';
  private loopTheta = 0;
  private loopActive = false;
  private loopDone = false;
  private boostCool = 0;
  private boostedThisStep = false;

  static async create(): Promise<DriveWorld> {
    await RAPIER.init();
    return new DriveWorld();
  }

  /** True when a downward ray at the start line hits a collider near y=0. */
  groundUnderSpawn(): boolean {
    this.world.step();
    const hit = this.world.castRay(new RAPIER.Ray({ x: SPAWN.x, y: 8, z: SPAWN.z }, { x: 0, y: -1, z: 0 }), 20, true);
    if (!hit) return false;
    const y = 8 - hit.timeOfImpact;
    return y > -0.4 && y < 2;
  }

  /** Flat catch-floor at the road height, used only if the heightfield did not register. */
  addSafetyFloor(): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(30, 0.4, 100)
        .setTranslation(0, -0.4, 50)
        .setFriction(1)
        .setCollisionGroups(mask(GROUP_WORLD, GROUP_CAR | GROUP_DEBRIS)),
      body,
    );
    this.world.step();
  }

  /** True while the held-throttle loop guide is carrying the car over the top. */
  isLooping(): boolean {
    return this.loopActive;
  }

  /** Drop the car onto its suspension before the first paint, then forget that drop. */
  settle(): void {
    for (let i = 0; i < 30; i++) this.step(1 / 60, { throttle: 0, steer: 0 });
    const y = this.chassis.translation().y;
    this.seenGround = false;
    this.wasAirborne = false;
    this.airTime = 0;
    this.peakFall = 0;
    this.maxAirY = y;
    this.crumpleWindow = 0;
  }

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.queue = new RAPIER.EventQueue(true);

    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const worldMask = mask(GROUP_WORLD, GROUP_CAR | GROUP_DEBRIS);

    for (const field of trackFields()) {
      this.world.createCollider(
        RAPIER.ColliderDesc.heightfield(field.nrows, field.ncols, field.heights, field.scale, RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES)
          .setTranslation(field.translation.x, field.translation.y, field.translation.z)
          .setFriction(field.friction)
          .setRestitution(field.restitution)
          .setCollisionGroups(worldMask),
        ground,
      );
    }

    // One solid floor under the whole field, including the pond gaps and the grass past every lane.
    const floorHalf = 2;
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(900, floorHalf, 900)
        .setTranslation(80, FIELD.floorY - floorHalf, 70)
        .setFriction(0.9)
        .setRestitution(0.02)
        .setCollisionGroups(worldMask),
      ground,
    );
    const spanX = (FIELD.maxX - FIELD.minX) / 2;
    const spanZ = (FIELD.maxZ - FIELD.minZ) / 2;
    const midX = (FIELD.minX + FIELD.maxX) / 2;
    const midZ = (FIELD.minZ + FIELD.maxZ) / 2;
    const wallY = 24;
    const walls = [
      { x: midX, z: FIELD.minZ, hx: spanX + 3, hz: 2 },
      { x: midX, z: FIELD.maxZ, hx: spanX + 3, hz: 2 },
      { x: FIELD.minX, z: midZ, hx: 2, hz: spanZ + 3 },
      { x: FIELD.maxX, z: midZ, hx: 2, hz: spanZ + 3 },
    ];
    for (const wall of walls) {
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(wall.hx, wallY, wall.hz)
          .setTranslation(wall.x, wallY, wall.z)
          .setFriction(0.4)
          .setRestitution(0.04)
          .setCollisionGroups(worldMask),
        ground,
      );
    }

    for (const ribbon of [loopRibbon(), quarterRibbon()]) {
      this.world.createCollider(
        RAPIER.ColliderDesc.trimesh(ribbon.vertices, ribbon.indices)
          .setFriction(1.15)
          .setRestitution(0.02)
          .setCollisionGroups(worldMask),
        ground,
      );
    }

    for (const box of barrierBoxes()) {
      const q = quatPitch(box.rotX);
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(box.half.x, box.half.y, box.half.z)
          .setTranslation(box.center.x, box.center.y, box.center.z)
          .setRotation(q)
          .setFriction(0.6)
          .setRestitution(0.08)
          .setCollisionGroups(worldMask),
        ground,
      );
    }

    this.chassis = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(SPAWN.x, SPAWN.y, SPAWN.z)
        .setLinearDamping(0.03)
        .setAngularDamping(0.55)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    // Wider and longer than the old toy, density held so the mass stays near 125 kg.
    const hull = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.82, 0.46, 1.48)
        .setTranslation(0, -0.2, 0)
        .setDensity(28)
        .setFriction(0.05)
        .setRestitution(0.02)
        .setCollisionGroups(mask(GROUP_CAR, GROUP_WORLD))
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(2200),
      this.chassis,
    );
    this.hull = hull;
    this.chassisColliders.push(hull);
    this.chassisHandles.add(hull.handle);

    this.vehicle = this.world.createVehicleController(this.chassis);
    this.vehicle.setIndexForwardAxis = 2;
    this.vehicle.indexUpAxis = 1;

    const down = { x: 0, y: -1, z: 0 };
    const axle = { x: -1, y: 0, z: 0 };
    for (const point of DEFAULT_AXLES) {
      this.vehicle.addWheel({ x: point.x, y: 0, z: point.z }, down, axle, restLength(point.radius), point.radius);
    }
    for (let i = 0; i < 4; i++) this.tuneWheel(i, DEFAULT_AXLES[i]);
  }

  /** Swap suspension, engine, and the box collider for a car, jeep, or monster truck. */
  fitVehicle(type: VehicleType, axles: Axle[] = axlesFor(type)): void {
    this.spec = vehicleSpec(type);
    this.chassis.setAngularDamping(this.spec.angularDamping);
    this.replaceHull();
    this.fitWheels(axles);
  }

  tireDrop(): number {
    return this.spec.drop;
  }

  /** Match the raycast axles to the loaded vehicle. Order is FL, FR, RL, RR. */
  fitWheels(axles: Axle[]): void {
    this.axles = axles.map((axle) => ({ ...axle }));
    for (let i = 0; i < 4; i++) {
      const axle = this.axles[i] ?? DEFAULT_AXLES[i];
      this.vehicle.setWheelChassisConnectionPointCs(i, { x: axle.x, y: 0, z: axle.z });
      this.tuneWheel(i, axle);
      this.pose.wheels[i].radius = axle.radius;
    }
  }

  private replaceHull(): void {
    if (this.hull) {
      this.chassisHandles.delete(this.hull.handle);
      this.world.removeCollider(this.hull, true);
      const index = this.chassisColliders.indexOf(this.hull);
      if (index >= 0) this.chassisColliders.splice(index, 1);
    }
    const { half, boxY, mass } = this.spec;
    const volume = 8 * half.x * half.y * half.z;
    const hull = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
        .setTranslation(0, boxY, 0)
        .setDensity(mass / volume)
        .setFriction(0.05)
        .setRestitution(this.spec.travel > 0.4 ? 0.08 : 0.02)
        .setCollisionGroups(mask(GROUP_CAR, GROUP_WORLD))
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(2200),
      this.chassis,
    );
    this.hull = hull;
    this.chassisColliders.push(hull);
    this.chassisHandles.add(hull.handle);
  }

  private tuneWheel(i: number, axle: Axle): void {
    const spec = this.spec;
    this.vehicle.setWheelSuspensionStiffness(i, spec.stiffness);
    this.vehicle.setWheelSuspensionCompression(i, spec.compression);
    this.vehicle.setWheelSuspensionRelaxation(i, spec.relaxation);
    this.vehicle.setWheelMaxSuspensionTravel(i, spec.travel);
    this.vehicle.setWheelMaxSuspensionForce(i, 40000);
    this.vehicle.setWheelFrictionSlip(i, i < 2 ? spec.frontGrip : spec.rearGrip);
    this.vehicle.setWheelSideFrictionStiffness(i, 1.2);
    this.vehicle.setWheelRadius(i, axle.radius);
    this.vehicle.setWheelSuspensionRestLength(i, restLength(axle.radius, this.spec.drop));
  }

  mass(): number {
    return this.chassis.mass();
  }

  /**
   * Pop a wheel off the raycast vehicle. A tiny leftover ray keeps the index
   * stable; the visual wheel becomes a free body in the scene.
   */
  detachWheel(index: number): void {
    if (this.hiddenWheels.has(index)) return;
    this.hiddenWheels.add(index);
    this.vehicle.setWheelRadius(index, 0.06);
    this.vehicle.setWheelSuspensionRestLength(index, 0.08);
    this.vehicle.setWheelFrictionSlip(index, 0.2);
  }

  spawnDebris(opts: {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    half: { x: number; y: number; z: number };
    ball?: number;
    velocity: { x: number; y: number; z: number };
    spin: { x: number; y: number; z: number };
  }): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(opts.position.x, opts.position.y, opts.position.z)
        .setRotation(opts.rotation)
        .setLinvel(opts.velocity.x, opts.velocity.y, opts.velocity.z)
        .setAngvel(opts.spin)
        .setLinearDamping(0.08)
        .setAngularDamping(0.12)
        .setCcdEnabled(true),
    );
    const desc = opts.ball
      ? RAPIER.ColliderDesc.ball(opts.ball)
      : RAPIER.ColliderDesc.cuboid(opts.half.x, opts.half.y, opts.half.z);
    desc
      .setDensity(180)
      .setFriction(0.55)
      .setRestitution(0.28)
      .setCollisionGroups(mask(GROUP_DEBRIS, GROUP_WORLD | GROUP_DEBRIS));
    const collider = this.world.createCollider(desc, body);
    this.debris.push({ body, collider });
    return body;
  }

  clearDebris(): void {
    for (const item of this.debris) {
      this.world.removeCollider(item.collider, true);
      this.world.removeRigidBody(item.body);
    }
    this.debris.length = 0;
  }

  reset(stuntId: StuntId = this.stuntId): void {
    this.clearDebris();
    this.hiddenWheels.clear();
    for (let i = 0; i < 4; i++) this.tuneWheel(i, this.axles[i]);
    const spawn = stuntById(stuntId).spawn;
    const ride = this.spec.drop + 0.3;
    this.stuntId = stuntById(stuntId).id;
    this.loopTheta = 0;
    this.loopActive = false;
    this.loopDone = false;
    this.boostCool = 0;
    this.chassis.setTranslation({ x: spawn.x, y: Math.max(spawn.y, ride), z: spawn.z }, true);
    this.chassis.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.chassis.wakeUp();
    this.steerAngle = 0;
    this.hopCool = 0;
    this.trickActive = false;
    this.trickTime = 0;
    this.trickAward = false;
    this.seenGround = false;
    this.wasAirborne = false;
    this.airTime = 0;
    this.maxAirY = spawn.y;
    this.peakFall = 0;
    this.crumpleWindow = 0;
  }

  step(dt: number, input: DriveInput): DrivePose {
    this.boostedThisStep = false;
    const pre = this.chassis.translation();
    const px = pre.x;
    const pz = pre.z;

    let steer = input.steer;
    const lane = laneCenter(px);
    if (Math.abs(steer) < 0.15 && Math.abs(px - lane) > 0.8 && Math.abs(px - lane) < 8) {
      const assist = Math.max(-0.28, Math.min(0.28, -(px - lane) * 0.05));
      steer += assist;
    }
    if (this.boostCool > 0) this.boostCool = Math.max(0, this.boostCool - dt);
    const vel = this.chassis.linvel();
    const speedNow = Math.hypot(vel.x, vel.z);
    const steerScale = 1 - 0.55 * Math.min(speedNow / 26, 1);
    const target = steer * 0.48 * steerScale;
    const blend = 1 - Math.exp(-10 * dt);
    this.steerAngle += (target - this.steerAngle) * blend;
    // Rapier's positive steer yaws toward -X. Negate it so -1 is the vehicle's left.
    this.vehicle.setWheelSteering(0, -this.steerAngle);
    this.vehicle.setWheelSteering(1, -this.steerAngle);
    this.vehicle.setWheelSteering(2, 0);
    this.vehicle.setWheelSteering(3, 0);

    const frontDown = this.vehicle.wheelIsInContact(0) || this.vehicle.wheelIsInContact(1);
    const rearDown = this.vehicle.wheelIsInContact(2) || this.vehicle.wheelIsInContact(3);
    const onLaunch = Math.abs(px) < 14;
    let force = input.throttle > 0.2 && !(onLaunch && pz >= 78) && speedNow < 32 ? this.spec.engine * Math.min(input.throttle, 1) : 0;
    if (!frontDown) force *= 0.35;
    if (!rearDown && !frontDown) force *= 0.5;
    this.vehicle.setWheelEngineForce(0, 0);
    this.vehicle.setWheelEngineForce(1, 0);
    this.vehicle.setWheelEngineForce(2, force);
    this.vehicle.setWheelEngineForce(3, force);
    this.vehicle.setWheelBrake(0, 0);
    this.vehicle.setWheelBrake(1, 0);
    this.vehicle.setWheelBrake(2, 0);
    this.vehicle.setWheelBrake(3, 0);

    this.applyBoost();
    this.vehicle.updateVehicle(dt, undefined, undefined, (collider) => !this.chassisHandles.has(collider.handle));
    this.world.step(this.queue);
    this.guideLoop(dt, input.throttle);

    let hitForce = 0;
    this.queue.drainContactForceEvents((event) => {
      const mag = event.maxForceMagnitude();
      if (mag > hitForce) hitForce = mag;
    });

    const t = this.chassis.translation();
    const r = this.chassis.rotation();
    const v = this.chassis.linvel();
    const x = t.x;
    const y = t.y;
    const z = t.z;
    let qx = r.x;
    let qy = r.y;
    let qz = r.z;
    let qw = r.w;
    const vx = v.x;
    const vy = v.y;
    const vz = v.z;

    let wheelsOn = 0;
    for (let i = 0; i < 4; i++) {
      const connection = this.vehicle.wheelChassisConnectionPointCs(i);
      const cx = connection?.x ?? 0;
      const cy = connection?.y ?? 0;
      const cz = connection?.z ?? 0;
      const suspension = this.vehicle.wheelSuspensionLength(i) ?? restLength(this.axles[i].radius, this.spec.drop);
      const grounded = !!this.vehicle.wheelIsInContact(i) && !this.hiddenWheels.has(i);
      if (grounded) wheelsOn += 1;
      const wheel = this.pose.wheels[i];
      wheel.x = cx;
      wheel.y = cy - suspension;
      wheel.z = cz;
      wheel.steer = this.vehicle.wheelSteering(i) ?? 0;
      wheel.spin = this.vehicle.wheelRotation(i) ?? 0;
      wheel.grounded = grounded;
      wheel.radius = this.vehicle.wheelRadius(i) ?? wheel.radius;
    }

    if (wheelsOn > 0) this.seenGround = true;
    const groundY = driveSurfaceHeight(z, x);
    const clearance = groundY === null ? y : y - groundY;
    const airborne = this.seenGround && wheelsOn === 0 && clearance > 1.15 && !this.loopActive;
    if (airborne) {
      this.airTime += dt;
      if (-vy > this.peakFall) this.peakFall = -vy;
    }
    if (y > this.maxAirY) this.maxAirY = y;

    const jumpAir = this.airTime;
    let landed = false;
    let fallSpeed = 0;
    if (this.wasAirborne && !airborne && this.airTime > 0.45 && this.maxAirY > 4) {
      landed = true;
      fallSpeed = Math.max(this.peakFall, Math.max(0, -vy));
      this.crumpleWindow = 2.4;
      this.airTime = 0;
      this.peakFall = 0;
    } else if (!airborne) {
      this.airTime = 0;
      this.peakFall = 0;
    }
    this.wasAirborne = airborne;
    if (this.crumpleWindow > 0) this.crumpleWindow = Math.max(0, this.crumpleWindow - dt);

    const wantContact = landed || (this.crumpleWindow > 0 && hitForce > 3500);
    const contact = wantContact ? (this.lowestContact() ?? { x, y: y - 0.45, z, force: hitForce }) : null;

    const extraHits: ContactPoint[] = [];
    if (!landed && this.crumpleWindow > 0 && hitForce > 4500 && contact) {
      extraHits.push({ x: contact.x, y: contact.y, z: contact.z, force: hitForce });
    }

    if (!this.trickActive && airborne && Math.abs(input.steer) > 0.25 && this.airTime > 0.15) {
      const av = this.chassis.angvel();
      const ax = av.x;
      const ay = av.y;
      const az = av.z;
      const spun = rotateByQuat(qx, qy, qz, qw, -input.steer * 1.5 * dt, 0, input.steer * 2.2 * dt);
      this.chassis.setAngvel({ x: ax + spun.x, y: ay + spun.y, z: az + spun.z }, true);
    }

    this.pose.hopped = false;
    this.pose.spun = false;
    this.pose.trickLanded = false;
    if (input.trick) this.beginTrick(airborne, x, y, z);
    this.applyTrick(dt, x, y, z);
    const spunRot = this.chassis.rotation();
    qx = spunRot.x;
    qy = spunRot.y;
    qz = spunRot.z;
    qw = spunRot.w;

    const pose = this.pose;
    pose.x = x;
    pose.y = y;
    pose.z = z;
    pose.qx = qx;
    pose.qy = qy;
    pose.qz = qz;
    pose.qw = qw;
    pose.vx = vx;
    pose.vy = vy;
    pose.vz = vz;
    pose.speed = Math.hypot(vx, vy, vz);
    pose.wheelsOn = wheelsOn;
    pose.airborne = airborne;
    pose.airTime = landed ? jumpAir : this.airTime;
    pose.maxAirY = this.maxAirY;
    pose.landed = landed;
    pose.fallSpeed = fallSpeed;
    pose.contact = contact ? { ...contact, force: Math.max(hitForce, fallSpeed * 800) } : null;
    pose.extraHits = extraHits;
    pose.looped = this.loopDone;
    pose.stunt = this.stuntId;
    pose.boosted = this.boostedThisStep;
    pose.rescue = y < FIELD.floorY - 2 || x < FIELD.minX - 8 || x > FIELD.maxX + 8 || z < FIELD.minZ - 8 || z > FIELD.maxZ + 8;
    return pose;
  }

  private applyBoost(): void {
    if (this.boostCool > 0) return;
    const t = this.chassis.translation();
    const pad = BOOSTS.find((item) => Math.abs(t.x - item.x) < 4 && Math.abs(t.z - item.z) < item.length * 0.5);
    if (!pad) return;
    const vel = this.chassis.linvel();
    this.chassis.setLinvel({ x: vel.x * 0.2, y: vel.y, z: Math.max(vel.z, 0) + pad.kick }, true);
    this.boostCool = 0.85;
    this.boostedThisStep = true;
  }

  /** A ground tap hops. An air tap plays one full spin and finishes upright. */
  private beginTrick(airborne: boolean, x: number, y: number, z: number): void {
    if (this.loopActive || this.hopCool > 0) return;
    const ground = driveSurfaceHeight(z, x);
    const clearance = ground === null ? y : y - ground;
    const vel = this.chassis.linvel();
    if (!airborne || clearance < this.spec.drop + 1.35) {
      this.chassis.setLinvel({ x: vel.x, y: Math.max(vel.y, airborne ? 3.4 : 4.6), z: vel.z }, true);
      this.hopCool = 0.5;
      this.pose.hopped = true;
      return;
    }
    if (this.trickActive) return;
    const rot = this.chassis.rotation();
    this.trickYaw = Math.atan2(2 * (rot.w * rot.y + rot.x * rot.z), 1 - 2 * (rot.y * rot.y + rot.z * rot.z));
    this.trickKind = this.trickKind === 'roll' ? 'yaw' : 'roll';
    this.trickDir = Math.random() < 0.5 ? -1 : 1;
    this.trickTime = 0;
    const falling = vel.y < -0.4 ? clearance / Math.max(0.8, -vel.y) : 1.2;
    this.trickDur = Math.min(0.9, Math.max(0.42, falling * 0.8));
    this.trickActive = true;
    this.hopCool = 0.35;
    this.pose.spun = true;
  }

  private applyTrick(dt: number, x: number, y: number, z: number): void {
    if (this.hopCool > 0) this.hopCool = Math.max(0, this.hopCool - dt);
    if (this.loopActive) this.trickActive = false;
    if (this.trickActive) {
      const ground = driveSurfaceHeight(z, x);
      const clearance = ground === null ? 8 : y - ground;
      const vel = this.chassis.linvel();
      const timeLeft = vel.y < -0.4 ? clearance / Math.max(0.5, -vel.y) : 2;
      const rush = timeLeft < 0.4 ? 0.4 / Math.max(0.12, timeLeft) : 1;
      this.trickTime += dt * rush;
      const u = Math.min(1, this.trickTime / this.trickDur);
      const angle = u * Math.PI * 2 * this.trickDir;
      const q = this.trickKind === 'yaw'
        ? quatYaw(this.trickYaw + angle)
        : quatMul(quatYaw(this.trickYaw), quatRoll(angle));
      this.chassis.setRotation(q, true);
      this.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
      const low = clearance < this.spec.drop + 0.55;
      if (u >= 1 || low) {
        this.chassis.setRotation(quatYaw(this.trickYaw), true);
        this.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.trickActive = false;
        if (u > 0.55) this.trickAward = true;
      }
    }
    this.pose.tricking = this.trickActive;
    if (this.trickAward && !this.trickActive) {
      const ground = driveSurfaceHeight(z, x);
      const clearance = ground === null ? 8 : y - ground;
      const wheels = [0, 1, 2, 3].filter((i) => this.vehicle.wheelIsInContact(i)).length;
      if (wheels >= 2 || clearance < this.spec.drop + 1.15) {
        this.pose.trickLanded = true;
        this.trickAward = false;
      }
    }
  }

  /** Keep a held throttle glued to the loop so a preschooler always gets around. */
  private guideLoop(dt: number, throttle: number): void {
    if (this.loopDone || this.stuntId !== 'loop' || throttle < 0.2) {
      if (throttle < 0.2) this.loopActive = false;
      return;
    }
    const t = this.chassis.translation();
    const near = Math.abs(t.x - LOOP.laneX) < 6 && t.z > LOOP.entryZ - 8 && t.z < LOOP.entryZ + 3 && t.y < this.spec.drop + 1.8;
    if (!this.loopActive && near && t.z > LOOP.entryZ - 1.2) this.loopActive = true;
    if (!this.loopActive) return;

    const speed = 16;
    this.loopTheta += speed * dt;
    if (this.loopTheta >= LOOP.length - 0.35) {
      this.loopActive = false;
      this.loopDone = true;
      this.chassis.setTranslation({ x: LOOP.exitX, y: this.spec.drop + 0.08, z: LOOP.exitZ + 2.5 }, true);
      this.chassis.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      this.chassis.setLinvel({ x: 0, y: 0, z: 16 }, true);
      this.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }
    const pose = loopPose(this.loopTheta, this.spec.drop);
    const quat = quatFromBasis(pose.left, pose.up, pose.fwd);
    this.chassis.setTranslation({ x: pose.x, y: pose.y, z: pose.z }, true);
    this.chassis.setRotation(quat, true);
    this.chassis.setLinvel({ x: 0, y: pose.fwd.y * speed, z: pose.fwd.z * speed }, true);
    this.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  private lowestContact(): ContactPoint | null {
    let best: ContactPoint | null = null;
    for (const collider of this.chassisColliders) {
      this.world.contactPairsWith(collider, (other) => {
        this.world.contactPair(collider, other, (manifold) => {
          const count = manifold.numSolverContacts();
          for (let i = 0; i < count; i++) {
            const point = manifold.solverContactPoint(i);
            if (!point) continue;
            const x = point.x;
            const y = point.y;
            const z = point.z;
            const impulse = manifold.numContacts() > 0 ? manifold.contactImpulse(Math.min(i, manifold.numContacts() - 1)) : 1;
            if (!best || y < best.y - 0.05 || impulse > best.force * 1.4) {
              best = { x, y, z, force: impulse };
            }
          }
        });
      });
    }
    return best;
  }
}

function quatFromBasis(
  right: { x: number; y: number; z: number },
  up: { x: number; y: number; z: number },
  fwd: { x: number; y: number; z: number },
): { x: number; y: number; z: number; w: number } {
  const m00 = right.x;
  const m01 = up.x;
  const m02 = fwd.x;
  const m10 = right.y;
  const m11 = up.y;
  const m12 = fwd.y;
  const m20 = right.z;
  const m21 = up.z;
  const m22 = fwd.z;
  const trace = m00 + m11 + m22;
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  const len = Math.hypot(x, y, z, w) || 1;
  return { x: x / len, y: y / len, z: z / len, w: w / len };
}

function quatYaw(yaw: number): { x: number; y: number; z: number; w: number } {
  const h = yaw * 0.5;
  return { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
}

function quatRoll(roll: number): { x: number; y: number; z: number; w: number } {
  const h = roll * 0.5;
  return { x: 0, y: 0, z: Math.sin(h), w: Math.cos(h) };
}

function quatMul(
  a: { x: number; y: number; z: number; w: number },
  b: { x: number; y: number; z: number; w: number },
): { x: number; y: number; z: number; w: number } {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function rotateByQuat(qx: number, qy: number, qz: number, qw: number, vx: number, vy: number, vz: number): { x: number; y: number; z: number } {
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return {
    x: vx + qw * tx + (qy * tz - qz * ty),
    y: vy + qw * ty + (qz * tx - qx * tz),
    z: vz + qw * tz + (qx * ty - qy * tx),
  };
}
