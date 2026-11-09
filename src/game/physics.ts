import RAPIER from '@dimforge/rapier3d-compat';
import { barrierBoxes, quatPitch, SPAWN, trackFields } from './terrain';

const GROUP_CAR = 0x0001;
const GROUP_WORLD = 0x0002;
const GROUP_DEBRIS = 0x0004;

function mask(membership: number, filter: number): number {
  return (membership & 0xffff) | ((filter & 0xffff) << 16);
}

export interface DriveInput {
  /** 0..1 hold-to-drive. */
  throttle: number;
  /** -1 left, +1 right. */
  steer: number;
}

export interface WheelPose {
  x: number;
  y: number;
  z: number;
  steer: number;
  spin: number;
  grounded: boolean;
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
}

export interface DebrisBody {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

const WHEEL_X = 0.82;
const WHEEL_Z_FRONT = 0.95;
const WHEEL_Z_REAR = -1.0;
const WHEEL_RADIUS = 0.38;
const SUSPENSION_REST = 0.62;
/** Tuned so a straight hold reaches the lip near 25 m/s and lands hard. */
const ENGINE_FORCE = 560;

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

  private readonly chassisHandles = new Set<number>();
  private readonly hiddenWheels = new Set<number>();
  private steerAngle = 0;
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
    wheels: [0, 1, 2, 3].map(() => ({ x: 0, y: 0, z: 0, steer: 0, spin: 0, grounded: false })),
    extraHits: [],
  };

  static async create(): Promise<DriveWorld> {
    await RAPIER.init();
    return new DriveWorld();
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

    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(48, 0.5, 130)
        .setTranslation(0, -1.15, 80)
        .setFriction(0.85)
        .setRestitution(0.05)
        .setCollisionGroups(worldMask),
      ground,
    );

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
    const hull = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.75, 0.28, 1.35)
        .setDensity(55)
        .setFriction(0.05)
        .setRestitution(0.02)
        .setCollisionGroups(mask(GROUP_CAR, GROUP_WORLD))
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(2200),
      this.chassis,
    );
    this.chassisColliders.push(hull);
    this.chassisHandles.add(hull.handle);

    this.vehicle = this.world.createVehicleController(this.chassis);
    this.vehicle.setIndexForwardAxis = 2;
    this.vehicle.indexUpAxis = 1;

    const down = { x: 0, y: -1, z: 0 };
    const axle = { x: -1, y: 0, z: 0 };
    const points = [
      { x: -WHEEL_X, y: 0, z: WHEEL_Z_FRONT },
      { x: WHEEL_X, y: 0, z: WHEEL_Z_FRONT },
      { x: -WHEEL_X, y: 0, z: WHEEL_Z_REAR },
      { x: WHEEL_X, y: 0, z: WHEEL_Z_REAR },
    ];
    for (const point of points) this.vehicle.addWheel(point, down, axle, SUSPENSION_REST, WHEEL_RADIUS);
    for (let i = 0; i < 4; i++) this.tuneWheel(i);
  }

  private tuneWheel(i: number): void {
    this.vehicle.setWheelSuspensionStiffness(i, 48);
    this.vehicle.setWheelSuspensionCompression(i, 7);
    this.vehicle.setWheelSuspensionRelaxation(i, 8);
    this.vehicle.setWheelMaxSuspensionTravel(i, 0.25);
    this.vehicle.setWheelMaxSuspensionForce(i, 40000);
    this.vehicle.setWheelFrictionSlip(i, i < 2 ? 180 : 140);
    this.vehicle.setWheelSideFrictionStiffness(i, 1.2);
    this.vehicle.setWheelRadius(i, WHEEL_RADIUS);
    this.vehicle.setWheelSuspensionRestLength(i, SUSPENSION_REST);
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

  reset(): void {
    this.clearDebris();
    this.hiddenWheels.clear();
    for (let i = 0; i < 4; i++) this.tuneWheel(i);
    this.chassis.setTranslation({ x: SPAWN.x, y: SPAWN.y, z: SPAWN.z }, true);
    this.chassis.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.chassis.wakeUp();
    this.steerAngle = 0;
    this.seenGround = false;
    this.wasAirborne = false;
    this.airTime = 0;
    this.maxAirY = SPAWN.y;
    this.peakFall = 0;
    this.crumpleWindow = 0;
  }

  step(dt: number, input: DriveInput): DrivePose {
    const pre = this.chassis.translation();
    const px = pre.x;
    const pz = pre.z;

    let steer = input.steer;
    if (Math.abs(steer) < 0.15 && pz < 76 && Math.abs(px) > 1) {
      const assist = Math.max(-0.28, Math.min(0.28, -px * 0.045));
      steer += assist;
    }
    const vel = this.chassis.linvel();
    const speedNow = Math.hypot(vel.x, vel.z);
    const steerScale = 1 - 0.55 * Math.min(speedNow / 26, 1);
    const target = steer * 0.48 * steerScale;
    const blend = 1 - Math.exp(-10 * dt);
    this.steerAngle += (target - this.steerAngle) * blend;
    this.vehicle.setWheelSteering(0, this.steerAngle);
    this.vehicle.setWheelSteering(1, this.steerAngle);
    this.vehicle.setWheelSteering(2, 0);
    this.vehicle.setWheelSteering(3, 0);

    const frontDown = this.vehicle.wheelIsInContact(0) || this.vehicle.wheelIsInContact(1);
    const rearDown = this.vehicle.wheelIsInContact(2) || this.vehicle.wheelIsInContact(3);
    let force = input.throttle > 0.2 && pz < 78 ? ENGINE_FORCE * Math.min(input.throttle, 1) : 0;
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

    this.vehicle.updateVehicle(dt, undefined, undefined, (collider) => !this.chassisHandles.has(collider.handle));
    this.world.step(this.queue);

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
    const qx = r.x;
    const qy = r.y;
    const qz = r.z;
    const qw = r.w;
    const vx = v.x;
    const vy = v.y;
    const vz = v.z;

    let wheelsOn = 0;
    for (let i = 0; i < 4; i++) {
      const connection = this.vehicle.wheelChassisConnectionPointCs(i);
      const cx = connection?.x ?? 0;
      const cy = connection?.y ?? 0;
      const cz = connection?.z ?? 0;
      const suspension = this.vehicle.wheelSuspensionLength(i) ?? SUSPENSION_REST;
      const grounded = !!this.vehicle.wheelIsInContact(i) && !this.hiddenWheels.has(i);
      if (grounded) wheelsOn += 1;
      const wheel = this.pose.wheels[i];
      wheel.x = cx;
      wheel.y = cy - suspension;
      wheel.z = cz;
      wheel.steer = this.vehicle.wheelSteering(i) ?? 0;
      wheel.spin = this.vehicle.wheelRotation(i) ?? 0;
      wheel.grounded = grounded;
    }

    if (wheelsOn > 0) this.seenGround = true;
    const airborne = this.seenGround && wheelsOn === 0 && y > 1.55;
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

    if (airborne && Math.abs(input.steer) > 0.25 && this.airTime > 0.15) {
      const av = this.chassis.angvel();
      const ax = av.x;
      const ay = av.y;
      const az = av.z;
      const spun = rotateByQuat(qx, qy, qz, qw, input.steer * 1.5 * dt, 0, -input.steer * 2.2 * dt);
      this.chassis.setAngvel({ x: ax + spun.x, y: ay + spun.y, z: az + spun.z }, true);
    }

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
    pose.speed = Math.hypot(vx, vz);
    pose.wheelsOn = wheelsOn;
    pose.airborne = airborne;
    pose.airTime = landed ? jumpAir : this.airTime;
    pose.maxAirY = this.maxAirY;
    pose.landed = landed;
    pose.fallSpeed = fallSpeed;
    pose.contact = contact ? { ...contact, force: Math.max(hitForce, fallSpeed * 800) } : null;
    pose.extraHits = extraHits;
    return pose;
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
