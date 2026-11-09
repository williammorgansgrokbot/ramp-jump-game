import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';

const shots = '/tmp/ramp-shots';
fs.mkdirSync(shots, { recursive: true });

interface Stats {
  ready: boolean;
  renderer: string;
  fps: number;
  quality: string;
  carId: string;
  position: { x: number; y: number; z: number };
  speed: number;
  airborne: boolean;
  maxAirY: number;
  airTime: number;
  dents: number;
  partsDetached: number;
  impacted: boolean;
  maxImpact: number;
  stars: number;
  restarts: number;
  drawCalls: number;
  triangles: number;
}

async function boot(page: Page, name: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/ramp-jump-game/');
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 40_000 });
  await page.screenshot({ path: `${shots}/${name}-start.png` });
  return errors;
}

async function hold(page: Page, label: string, pointerId = 1): Promise<void> {
  const button = page.getByRole('button', { name: label });
  await button.dispatchEvent('pointerdown', { pointerId, bubbles: true, button: 0, pointerType: 'touch', clientX: 20, clientY: 20 });
}

async function release(page: Page, label: string, pointerId = 1): Promise<void> {
  const button = page.getByRole('button', { name: label });
  await button.dispatchEvent('pointerup', { pointerId, bubbles: true, button: 0, pointerType: 'touch' });
}

test('loads, drives, jumps, and crashes', async ({ page }, info) => {
  const errors = await boot(page, info.project.name);
  const portrait = info.project.name.includes('portrait');

  for (const label of ['Go', 'Left', 'Right', 'Restart', 'Tilt']) {
    const box = await page.getByRole('button', { name: label }).boundingBox();
    expect(box, label).toBeTruthy();
    const view = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(-2);
    expect(box!.y).toBeGreaterThanOrEqual(-2);
    expect(box!.x + box!.width).toBeLessThanOrEqual(view.width + 2);
    expect(box!.y + box!.height).toBeLessThanOrEqual(view.height + 2);
  }

  if (!portrait) {
    await page.getByRole('button', { name: 'Boy 2' }).dispatchEvent('pointerdown');
    await page.waitForFunction(() => window.__game?.carId === 'boy2');
  }

  await hold(page, 'Go', 1);
  await hold(page, 'Right', 2);
  await page.waitForFunction(() => Math.abs(window.__game?.position.x ?? 0) > 0.45, undefined, { timeout: 12_000 });
  await release(page, 'Right', 2);
  await release(page, 'Go', 1);
  await page.getByRole('button', { name: 'Restart' }).dispatchEvent('pointerdown');
  await page.waitForFunction(() => Math.abs(window.__game?.position.x ?? 1) < 0.5 && (window.__game?.position.z ?? 99) < 12);
  await hold(page, 'Go', 1);
  await page.waitForFunction(() => (window.__game?.position.z ?? 0) > 30, undefined, { timeout: 25_000 });
  await page.screenshot({ path: `${shots}/${info.project.name}-runway.png` });
  await page.waitForFunction(() => (window.__game?.maxAirY ?? 0) > 6, undefined, { timeout: 20_000 });
  await page.screenshot({ path: `${shots}/${info.project.name}-air.png` });
  await page.waitForFunction(
    () => {
      const game = window.__game;
      return !!game && (game.impacted || game.dents > 0 || game.partsDetached > 0);
    },
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/${info.project.name}-crash.png` });
  await release(page, 'Go', 1);

  const summary = await page.evaluate(() => window.__game as Stats);
  console.log(info.project.name, JSON.stringify(summary));
  expect(summary.renderer).toBe('webgl2');
  expect(summary.maxAirY).toBeGreaterThan(6);
  expect(summary.impacted || summary.dents > 0 || summary.partsDetached > 0).toBeTruthy();
  expect(summary.stars).toBeGreaterThan(0);

  const before = summary.restarts;
  await page.getByRole('button', { name: 'Restart' }).dispatchEvent('pointerdown');
  await page.waitForFunction((prev) => (window.__game?.restarts ?? 0) > prev && (window.__game?.position.z ?? 99) < 10, before);
  await page.screenshot({ path: `${shots}/${info.project.name}-restart.png` });
  expect(errors, errors.join('\n')).toEqual([]);
});

declare global {
  interface Window {
    __game?: Stats;
  }
}
