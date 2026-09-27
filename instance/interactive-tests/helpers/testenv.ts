/**
 * Loads `instance/test.env` into `process.env`.
 *
 * Imported for its side effect by `playwright.config.ts`, which Playwright
 * evaluates before any spec, so every scenario and helper sees the values.
 *
 * Hand-parsed rather than pulled from `dotenv`: this package's only dependency
 * is `@playwright/test`, and a config file that cannot load without an
 * `npm install` is a config file that breaks the suite on a fresh checkout.
 *
 * Two rules, matching `instance/scripts/utils/testenv.py` exactly so the two
 * harnesses cannot drift:
 *
 * - The real environment WINS. A value already in `process.env` is never
 *   overwritten, so CI overrides the file without editing it.
 * - A missing file is not an error. Every consumer passes a default.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** instance/test.env — two levels up from helpers/ */
export const TEST_ENV_PATH = resolve(HERE, '..', '..', 'test.env');

export function loadTestEnv(path: string = TEST_ENV_PATH): Record<string, string> {
  const declared: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return declared;
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!key) continue;
    declared[key] = value;
    // A blank value means "declared but unset" (notably E2E_RECORD, a flag the
    // recorder turns on). Leaving it absent keeps `process.env` honest.
    if (value && process.env[key] === undefined) process.env[key] = value;
  }
  return declared;
}

/** An E2E setting, after `loadTestEnv` has run. */
export function env(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

/** An E2E setting parsed as a number, falling back when unset or unparseable. */
export function envInt(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** True when the suite is being recorded rather than merely run. */
export function isRecording(): boolean {
  const flag = process.env.E2E_RECORD ?? '';
  return flag !== '' && flag !== '0' && flag.toLowerCase() !== 'false';
}


/**
 * The test-client header, or nothing when the lane is not configured.
 *
 * Deliberately NOT set as Playwright's `use.extraHTTPHeaders`: that applies to
 * every request the *browser* makes, including cross-origin ones. Sending a
 * custom header to `fonts.gstatic.com` turns a simple font request into a
 * preflighted one, Google does not allow the header, and the fonts fail with a
 * CORS error -- visible in the console and, worse, in a recorded walkthrough,
 * where the app silently renders in fallback fonts.
 *
 * It is not needed from the browser anyway: the app's own API calls are
 * authenticated and sit under the generous per-user rate, and the only tightly
 * throttled endpoints (login, register) are hit once per run from the login
 * form. It is the *harness's* own API traffic -- signing three personas in
 * across nineteen scenarios -- that needs the lane, so the header goes on those
 * calls explicitly.
 */
export function testClientHeaders(): Record<string, string> {
  const token = env('E2E_THROTTLE_BYPASS_TOKEN');
  return token ? { 'X-E2E-Bypass-Token': token } : {};
}

loadTestEnv();
