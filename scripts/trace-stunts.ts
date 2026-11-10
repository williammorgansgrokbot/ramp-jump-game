import { DriveWorld } from '../src/game/physics';
import type { StuntId } from '../src/game/stunts';

async function run(id: StuntId): Promise<void> {
  const drive = await DriveWorld.create();
  drive.reset(id);
  console.log('---', id);
  for (let i = 0; i < 500; i++) {
    const pose = drive.step(1 / 60, { throttle: 1, steer: 0 });
    if (i % 20 === 0) console.log(`t=${(i / 60).toFixed(1)} z=${pose.z.toFixed(1)} y=${pose.y.toFixed(2)} spd=${pose.speed.toFixed(1)} w=${pose.wheelsOn}`);
  }
}
await run('gap');
await run('mega');
