import { defineConfig, devices } from '@playwright/test';

const chromeArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'tests',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    video: { mode: 'on', size: { width: 1280, height: 800 } },
    screenshot: 'off',
    launchOptions: { args: chromeArgs },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173/ramp-jump-game/',
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'ipad',
      use: {
        ...devices['iPad Pro 11'],
        browserName: 'chromium',
        defaultBrowserType: 'chromium',
        viewport: { width: 1194, height: 834 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'iphone',
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        defaultBrowserType: 'chromium',
        viewport: { width: 844, height: 390 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'iphone-portrait',
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        defaultBrowserType: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
