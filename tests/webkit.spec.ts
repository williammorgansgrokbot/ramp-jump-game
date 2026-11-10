import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';

const shots = '/tmp/ramp-shots';
fs.mkdirSync(shots, { recursive: true });

async function boot(page: Page, name: string, query = '') {
  const errors: string[] = [];
  const logs: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => {
    const line = `${msg.type()}: ${msg.text()}`;
    logs.push(line);
    if (msg.type() === 'error') errors.push(line);
  });
  await page.goto(`/ramp-jump-game/${query}`);
  const ready = await page
    .waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 40_000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${shots}/${name}.png` });
  const stats = await page.evaluate(() => window.__game ?? null);
  console.log(name, JSON.stringify({ ready, stats, errors, logs: logs.slice(-30) }));
  return { ready, stats, errors };
}

test('webkit scene stays up', async ({ page }, info) => {
  const query = info.project.name.includes('webgpu') ? '?webgpu=1&debug=1' : '?debug=1';
  const result = await boot(page, info.project.name, query);
  expect(result.ready, result.errors.join('\n')).toBe(true);
  expect(result.stats?.renderer).toBe('webgl2');
  expect(result.stats?.position.y ?? -99).toBeGreaterThan(0.2);
  expect(result.stats?.position.y ?? 99).toBeLessThan(4);
  expect(result.stats?.dpr ?? 0).toBeGreaterThanOrEqual(1.5);
  expect(result.stats?.assets).toBe('ok');
  expect(result.stats?.physics).toBe('track');
  expect(result.errors, result.errors.join('\n')).toEqual([]);

  if (!info.project.name.includes('webgpu') && !info.project.name.includes('loop')) {
    await page.getByRole('button', { name: 'Go' }).dispatchEvent('pointerdown', { pointerId: 1, bubbles: true, pointerType: 'touch' });
    await page.waitForFunction(() => (window.__game?.position.z ?? 0) > 12, undefined, { timeout: 15_000 });
    const moving = await page.evaluate(() => window.__game?.position.y ?? 0);
    expect(moving).toBeGreaterThan(0.3);
    await page.screenshot({ path: `${shots}/${info.project.name}-drive.png` });
  }
});

test('holding go completes the loop', async ({ page }, info) => {
  test.setTimeout(160_000);
  if (info.project.name.includes('webgpu')) return;
  const result = await boot(page, `${info.project.name}-loop`, '?debug=1');
  expect(result.ready, result.errors.join('\n')).toBe(true);
  await page.getByRole('button', { name: 'Loop' }).dispatchEvent('pointerdown', { pointerId: 1, bubbles: true, pointerType: 'touch' });
  await page.waitForFunction(() => window.__game?.stunt === 'loop' && (window.__game?.position.z ?? 99) < 12, undefined, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Go' }).dispatchEvent('pointerdown', { pointerId: 1, bubbles: true, pointerType: 'touch' });
  await page.waitForFunction(() => window.__game?.looped === true, undefined, { timeout: 120_000 });
  await page.screenshot({ path: `${shots}/${info.project.name}-loop-done.png` });
  const stats = await page.evaluate(() => window.__game);
  console.log('loop', info.project.name, JSON.stringify(stats));
  expect(stats?.position.y ?? 0).toBeGreaterThan(0.3);
  expect(result.errors, result.errors.join('\n')).toEqual([]);
});

declare global {
  interface Window {
    __game?: {
    ready: boolean;
    position: { y: number; z: number };
    renderer: string;
    dpr?: number;
    assets?: string;
    physics?: string;
    stunt?: string;
    looped?: boolean;
    fps?: number;
  };
  }
}
