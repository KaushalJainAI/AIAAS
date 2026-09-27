import { defineConfig, devices } from '@playwright/test';
// Side effect: loads instance/test.env into process.env before anything below
// reads it. Playwright evaluates this config ahead of every spec, so the whole
// suite -- config, helpers and scenarios -- sees one set of values, the same
// file the Python harnesses read.
import { env, envInt, isRecording } from './helpers/testenv';

// Reuses better-n8n-frontend's dev server if already running.
// For standalone CI, let this config start it: E2E_NO_SERVER=1 to skip webServer.

const FE_URL = env('E2E_BASE_URL', 'http://localhost:5173');
const API_URL = env('E2E_API_URL', 'http://localhost:8000');

// Recording mode trades speed for watchability: video on every scenario (not
// just failures) and a viewport sized for the finished file. Ordinary runs keep
// the cheap defaults, because a suite that always records is a suite nobody
// runs on every change.
const RECORDING = isRecording();

export default defineConfig({
  testDir: './scenarios',
  testMatch: /.*\.spec\.ts/,
  // Sized for real provider calls, not a local stub. See test.env.
  timeout: RECORDING ? envInt('E2E_TEST_TIMEOUT', 45_000) * 4 : envInt('E2E_TEST_TIMEOUT', 45_000),
  expect: { timeout: envInt('E2E_EXPECT_TIMEOUT', 8_000) },
  retries: process.env.CI ? 2 : 0,
  fullyParallel: false, // journeys share auth + backend state; keep serial
  // One worker, so the token cache in helpers/auth.ts is actually shared.
  // Playwright spreads spec *files* across workers even with fullyParallel
  // off, and each worker is its own process with its own module state -- so
  // with the default worker count every file signed in again and tripped the
  // 5/minute login throttle.
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ...(process.env.CI ? [['junit', { outputFile: 'test-results/junit.xml' }] as const] : []),
  ],
  use: {
    baseURL: FE_URL,
    // NOTE: the test-client rate-lane header is deliberately *not* set here as
    // `extraHTTPHeaders` -- that would attach it to every cross-origin request
    // the browser makes and break Google Fonts on a CORS preflight. It is
    // applied per-call by `helpers/testenv.ts::testClientHeaders`.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: RECORDING
      ? {
          mode: 'on',
          size: {
            width: envInt('E2E_VIDEO_WIDTH', 1280),
            height: envInt('E2E_VIDEO_HEIGHT', 720),
          },
        }
      : 'retain-on-failure',
    actionTimeout: envInt('E2E_ACTION_TIMEOUT', 10_000),
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: {
          width: envInt('E2E_VIDEO_WIDTH', 1280),
          height: envInt('E2E_VIDEO_HEIGHT', 720),
        },
      },
    },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : [
        // Backend — if manage.py runserver isn't already up, start it
        // (requires Backend/.env; comment out if you run it manually).
        // {
        //   command: 'python ../.../Backend/manage.py runserver 0.0.0.0:8000',
        //   url: `${API_URL}/api/health/`,
        //   reuseExistingServer: true,
        //   timeout: 60_000,
        // },
        {
          command: 'npm run dev --prefix ../../better-n8n-frontend',
          url: FE_URL,
          reuseExistingServer: true,
          timeout: 60_000,
        },
      ],
});
