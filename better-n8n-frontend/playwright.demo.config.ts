/**
 * Recording config for the product walkthrough — separate from
 * `playwright.config.ts` because that one is a test runner (video only on
 * failure, short timeouts, spins up a dev server) and this one is a camera:
 * video always, generous timeouts because it waits on real agent runs, and no
 * webServer since it points at production.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/demo',
  testMatch: /.*\.spec\.ts/,
  timeout: 15 * 60_000,
  expect: { timeout: 60_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: './demo-recordings',
  use: {
    baseURL: process.env.DEMO_BASE_URL ?? 'https://aiaas.kaushaljain.com',
    viewport: { width: 1440, height: 900 },
    video: { mode: 'on', size: { width: 1440, height: 900 } },
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
  },
  // Viewport AFTER the device spread: the preset carries its own 1280x720,
  // which silently wins otherwise and letterboxes the recording.
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
  }],
});
