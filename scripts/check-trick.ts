import { DriveWorld } from '../src/game/physics';

const drive = await DriveWorld.create();
drive.reset();
let x = 0;
for (let i = 0; i < 150; i++) x = drive.step(1 / 60, { throttle: 1, steer: -1 }).x;
console.log('left steer x', x.toFixed(2));
if (x < 0.8) process.exit(1);
drive.reset();
let rx = 0;
for (let i = 0; i < 150; i++) rx = drive.step(1 / 60, { throttle: 1, steer: 1 }).x;
console.log('right steer x', rx.toFixed(2));
if (rx > -0.8) process.exit(1);

drive.reset();
for (let i = 0; i < 20; i++) drive.step(1 / 60, { throttle: 0, steer: 0 });
const hop = drive.step(1 / 60, { throttle: 0, steer: 0, trick: true });
console.log('hop', hop.hopped, hop.vy.toFixed(2));
if (!hop.hopped) process.exit(1);

for (const kind of ['car', 'jeep', 'monster'] as const) {
  drive.fitVehicle(kind);
  drive.reset();
  let spun = false;
  let landedTrick = false;
  let upright = 1;
  let spunAt = -1;
  for (let i = 0; i < 800; i++) {
    const pose = drive.step(1 / 60, { throttle: 1, steer: 0, trick: i === spunAt });
    if (!spun && pose.airborne && pose.y > 8) spunAt = i + 1;
    if (pose.spun) spun = true;
    if (pose.trickLanded) landedTrick = true;
    upright = 1 - 2 * (pose.qx * pose.qx + pose.qz * pose.qz);
    if (landedTrick) {
      console.log(kind, { spun, landedTrick, upright: +upright.toFixed(2), i, y: +pose.y.toFixed(2) });
      break;
    }
    if (i === 799) console.log(kind, { spun, landedTrick, upright: +upright.toFixed(2), y: +pose.y.toFixed(2), air: pose.airborne });
  }
  if (!spun || !landedTrick || upright < 0.7) process.exit(1);
}
