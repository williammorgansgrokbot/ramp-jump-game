import { DriveWorld } from '../src/game/physics';
import type { VehicleType } from '../src/game/carFit';
import { GAP } from '../src/game/stunts';

const drive = await DriveWorld.create();
const kinds: VehicleType[] = ['car', 'jeep', 'monster'];

for (const kind of kinds) {
  drive.fitVehicle(kind);
  drive.reset('loop');
  let maxY = 0;
  let looped = false;
  let end = '';
  for (let i = 0; i < 900; i++) {
    const pose = drive.step(1 / 60, { throttle: 1, steer: 0 });
    if (pose.y > maxY) maxY = pose.y;
    if (pose.looped) {
      looped = true;
      end = `z=${pose.z.toFixed(1)} y=${pose.y.toFixed(2)}`;
      break;
    }
  }
  drive.reset('gap');
  let minGapY = 99;
  let landed = false;
  const drop = drive.tireDrop();
  for (let i = 0; i < 900; i++) {
    const pose = drive.step(1 / 60, { throttle: 1, steer: 0 });
    if (pose.z > GAP.rampZ1 + 2 && pose.z < GAP.landZ0 - 1) minGapY = Math.min(minGapY, pose.y);
    if (pose.z > GAP.landZ0 + 8 && pose.wheelsOn >= 2) {
      landed = true;
      break;
    }
  }
  const cleared = landed && minGapY > drop + 0.8;
  console.log(JSON.stringify({ kind, maxY: +maxY.toFixed(2), looped, end, minGapY: +minGapY.toFixed(2), cleared, drop }));
  if (!(looped && maxY > 8 && cleared)) {
    console.error(`${kind} loop/gap check failed`);
    process.exit(1);
  }
}
