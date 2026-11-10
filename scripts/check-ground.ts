import RAPIER from '@dimforge/rapier3d-compat';
import { DriveWorld } from '../src/game/physics';
import { driveSurfaceHeight, surfaceGrids } from '../src/game/terrain';

/**
 * The visible deck is built from `surfaceGrids()`, and the heightfield collider
 * is filled from the same arrays. A downward ray sometimes misses a heightfield
 * edge, so this casts a small ball and reads the contact point.
 */
const drive = await DriveWorld.create();
drive.chassis.setTranslation({ x: 400, y: 40, z: -80 }, true);
const world = drive.world;
world.step();

const ball = new RAPIER.Ball(0.02);
const rot = { w: 1, x: 0, y: 0, z: 0 };
const down = { x: 0, y: -1, z: 0 };
let worst = 0;
let checked = 0;
const failures: string[] = [];

function probe(x: number, z: number): void {
  const visual = driveSurfaceHeight(z, x);
  if (visual === null) return;
  // Start just above the deck so a loop or quarter passing overhead is not the first hit.
  const originY = visual + 2;
  const hit = world.castShape({ x, y: originY, z }, rot, down, ball, 0, 8, true);
  checked += 1;
  if (!hit) {
    failures.push(`miss x=${x} z=${z.toFixed(2)} visual=${visual.toFixed(3)}`);
    return;
  }
  const phys = hit.witness1.y;
  const delta = phys - visual;
  worst = Math.max(worst, Math.abs(delta));
  if (Math.abs(delta) > 0.02) {
    failures.push(`x=${x.toFixed(1)} z=${z.toFixed(2)} phys=${phys.toFixed(3)} visual=${visual.toFixed(3)} d=${delta.toFixed(3)}`);
  }
}

for (const grid of surfaceGrids()) {
  if (Math.abs(grid.x) > 1) {
    for (let i = 0; i < grid.samples; i += 3) {
      const z = grid.z0 + (i / (grid.samples - 1)) * (grid.z1 - grid.z0);
      if (z < grid.z0 + 0.8 || z > grid.z1 - 0.8) continue;
      probe(grid.x, z);
    }
  }
  for (let i = 0; i < grid.samples; i += 2) {
    const z = grid.z0 + (i / (grid.samples - 1)) * (grid.z1 - grid.z0);
    for (const x of [0, 4, -4]) probe(x, z);
  }
  for (let z = grid.z0 + 0.37; z < grid.z1 - 0.2; z += 3.5) {
    probe(0, z);
    probe(6.5, z);
  }
}

drive.reset();
let minClear = 10;
for (let i = 0; i < 260; i++) {
  const pose = drive.step(1 / 60, { throttle: 1, steer: 0 });
  if (i < 40 || pose.z < 8 || pose.z > 46 || pose.wheelsOn < 4) continue;
  const { qx, qy, qz, qw } = pose;
  for (const wheel of pose.wheels) {
    const wx = pose.x + (1 - 2 * (qy * qy + qz * qz)) * wheel.x + 2 * (qx * qy - qw * qz) * wheel.y + 2 * (qx * qz + qw * qy) * wheel.z;
    const wy = pose.y + 2 * (qx * qy + qw * qz) * wheel.x + (1 - 2 * (qx * qx + qz * qz)) * wheel.y + 2 * (qy * qz - qw * qx) * wheel.z;
    const wz = pose.z + 2 * (qx * qz - qw * qy) * wheel.x + 2 * (qy * qz + qw * qx) * wheel.y + (1 - 2 * (qx * qx + qy * qy)) * wheel.z;
    const upY = 1 - 2 * (qx * qx + qz * qz);
    const surface = driveSurfaceHeight(wz);
    if (surface === null) continue;
    void wx;
    const bottom = wy - (wheel.radius || 0.5) * upY;
    minClear = Math.min(minClear, bottom - surface);
  }
}

console.log(`checked ${checked} samples, worstAbsDelta ${worst.toFixed(4)} m, runwayTireClear ${minClear.toFixed(3)} m`);
if (minClear < -0.03) failures.push(`tires sink on the runway by ${(-minClear).toFixed(3)} m`);
if (failures.length) {
  console.error(failures.slice(0, 24).join('\n'));
  console.error(`ground check failed on ${failures.length} samples`);
  process.exit(1);
}
