import { LOOP } from '../src/game/stunts';
import { laneObstructions, pathBlocked, segmentGap, supportTubeCount } from '../src/game/stuntShow';

const gap = segmentGap(0, 1, 0, 2, 1, 0, 1, 1, -1, 1, 1, 1);
const parallel = segmentGap(0, 0, 0, 2, 0, 0, 0, 1, 0, 2, 1, 0);
const apart = segmentGap(0, 0, 0, 1, 0, 0, 0, 0, 3, 1, 0, 3);
if (gap > 1e-4 || Math.abs(parallel - 1) > 1e-4 || Math.abs(apart - 3) > 1e-4) {
  console.error('segment distance check failed', { gap, parallel, apart });
  process.exit(1);
}

const crown = LOOP.frames.reduce((best, frame) => (frame.y > best.y ? frame : best));
const across = (lat: number, up: number) => ({
  x: crown.x + crown.lx * lat + crown.nx * up,
  y: crown.y + crown.ly * lat + crown.ny * up,
  z: crown.z + crown.lz * lat + crown.nz * up,
});
const planted = pathBlocked(across(-(LOOP.halfW - 0.3), 0.9), across(LOOP.halfW - 0.3, 0.9), 0.05);
const beside = pathBlocked(across(-(LOOP.halfW + 1.4), 0.4), across(-(LOOP.halfW + 2.2), 1.2), 0.12);
const under = pathBlocked(across(-(LOOP.halfW - 0.4), -0.7), across(LOOP.halfW - 0.4, -0.7), 0.08);
if (!planted || beside || under) {
  console.error('driving-ray check failed', { planted, beside, under });
  process.exit(1);
}

const tubes = supportTubeCount();
const hits = laneObstructions();
console.log(`tubes ${tubes}`);
console.log(`obstructions ${hits.length}`);
for (const hit of hits) console.log(hit);
if (tubes < 40) {
  console.error('support tubes disappeared');
  process.exit(1);
}
if (hits.length) process.exit(1);
