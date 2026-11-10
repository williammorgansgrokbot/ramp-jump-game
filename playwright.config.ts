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
    video: 'off',
    screenshot: 'off',
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
      testMatch: /drive\.spec\.ts/,
      use: {
        ...devices['iPad Pro 11'],
        browserName: 'chromium',
        defaultBrowserType: 'chromium',
        launchOptions: { args: chromeArgs },
        viewport: { width: 1194, height: 834 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'iphone',
      testMatch: /drive\.spec\.ts/,
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        defaultBrowserType: 'chromium',
        launchOptions: { args: chromeArgs },
        viewport: { width: 844, height: 390 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'iphone-portrait',
      testMatch: /drive\.spec\.ts/,
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        defaultBrowserType: 'chromium',
        launchOptions: { args: chromeArgs },
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      },
    },
  {
      name: 'webkit-iphone',
      testMatch: /webkit\.spec\.ts/,
      use: {
        ...devices['iPhone 14 Pro Max'],
        browserName: 'webkit',
        defaultBrowserType: 'webkit',
      },
    },
    {
      name: 'webkit-iphone-webgpu',
      testMatch: /webkit\.spec\.ts/,
      use: {
        ...devices['iPhone 14 Pro Max'],
        browserName: 'webkit',
        defaultBrowserType: 'webkit',
      },
    },
    {
      name: 'webkit-ipad',
      testMatch: /webkit\.spec\.ts/,
      use: {
        ...devices['iPad Pro 11 landscape'],
        browserName: 'webkit',
        defaultBrowserType: 'webkit',
      },
    },
  ],
});
