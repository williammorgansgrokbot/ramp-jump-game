import { DriveWorld } from '../src/game/physics';

const drive = await DriveWorld.create();
console.log('mass', drive.mass().toFixed(1));
let maxY = 0;
let landed = false;
let fall = 0;
let landZ = 0;
let lip = '';
for (let i = 0; i < 800; i++) {
  const pose = drive.step(1 / 60, { throttle: 1, steer: 0 });
  if (pose.y > maxY) maxY = pose.y;
  if (!lip && pose.z > 74 && pose.y > 6) lip = `z=${pose.z.toFixed(1)} y=${pose.y.toFixed(2)} spd=${pose.speed.toFixed(1)} vy=${pose.vy.toFixed(1)}`;
  if (pose.landed) {
    landed = true;
    fall = pose.fallSpeed;
    landZ = pose.z;
    break;
  }
  if (i % 60 === 0) {
    console.log(`t=${(i / 60).toFixed(1)} z=${pose.z.toFixed(1)} y=${pose.y.toFixed(2)} spd=${pose.speed.toFixed(1)} w=${pose.wheelsOn} air=${pose.airborne ? 1 : 0}`);
  }
}
console.log(JSON.stringify({ maxY: +maxY.toFixed(2), landed, fall: +fall.toFixed(2), landZ: +landZ.toFixed(1), lip }));
if (!(maxY > 6 && landed && fall > 4)) {
  console.error('drive check failed');
  process.exit(1);
}
