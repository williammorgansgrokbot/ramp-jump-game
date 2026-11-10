import { DriveWorld } from '../src/game/physics';
import type { StuntId } from '../src/game/stunts';

async function run(id: StuntId): Promise<void> {
  const drive = await DriveWorld.create();
  drive.reset(id);
  let maxY = 0;
  let minY = 99;
  let endZ = 0;
  let endY = 0;
  for (let i = 0; i < 900; i++) {
    const pose = drive.step(1 / 60, { throttle: 1, steer: 0 });
    if (pose.y > maxY) maxY = pose.y;
    if (pose.y < minY) minY = pose.y;
    endZ = pose.z;
    endY = pose.y;
  }
  console.log(`${id} maxY=${maxY.toFixed(2)} minY=${minY.toFixed(2)} endZ=${endZ.toFixed(1)} endY=${endY.toFixed(2)}`);
}

await run('quarter');
await run('gap');
await run('mega');
