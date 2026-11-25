import { defineConfig, devices } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts/,
  // Live runs only (E2E_LIVE_MODEL=1): record the spend at the start, print it at the end.
  globalSetup: './tests/e2e/live/helpers/global-setup.ts',
  globalTeardown: './tests/e2e/live/helpers/global-teardown.ts',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE,
    // The test-client rate lane; see tests/e2e/helpers/session.ts BYPASS_HEADERS.
    extraHTTPHeaders: process.env.E2E_THROTTLE_BYPASS_TOKEN
      ? { 'X-E2E-Bypass-Token': process.env.E2E_THROTTLE_BYPASS_TOKEN }
      : undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // If `npm run dev` isn't already running, Playwright will start it.
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: 'npm run dev',
        url: BASE,
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
