import { DriveWorld } from '../src/game/physics';

const drive = await DriveWorld.create();
drive.reset('loop');
let maxY = 0;
let looped = false;
let end = '';
for (let i = 0; i < 700; i++) {
  const pose = drive.step(1 / 60, { throttle: 1, steer: 0 });
  if (pose.y > maxY) maxY = pose.y;
  if (pose.looped) {
    looped = true;
    end = `z=${pose.z.toFixed(1)} y=${pose.y.toFixed(2)}`;
    break;
  }
  if (i % 30 === 0) console.log(`t=${(i / 60).toFixed(1)} x=${pose.x.toFixed(1)} z=${pose.z.toFixed(1)} y=${pose.y.toFixed(2)} spd=${pose.speed.toFixed(1)}`);
}
console.log(JSON.stringify({ maxY: +maxY.toFixed(2), looped, end }));
if (!(looped && maxY > 8)) {
  console.error('loop check failed');
  process.exit(1);
}
