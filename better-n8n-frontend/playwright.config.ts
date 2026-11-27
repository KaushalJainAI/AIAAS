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
    // No extraHTTPHeaders here. A custom header on every browser request makes
    // the browser ask CORS first, the API does not allow X-E2E-Bypass-Token, and
    // every page lands on /login (Google Fonts failed too). The rate lane is only
    // needed for the sign-ups the specs make from Node: helpers/session.ts
    // BYPASS_HEADERS.
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
