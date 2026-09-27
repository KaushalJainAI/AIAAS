/**
 * Auth helpers — mimic a regular user's login via API, then inject tokens
 * into the browser so Playwright starts already authenticated.
 *
 * Mirrors better-n8n-frontend/tests/e2e/connections.spec.ts:freshLogin approach.
 * Uses the same localStorage keys as better-n8n-frontend/src/api/client.ts:tokenManager
 * (access_token, refresh_token) and the same endpoints as Backend/core/urls.py.
 */
import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { env, testClientHeaders } from './testenv';

export const API_BASE = env('E2E_API_URL', 'http://localhost:8000');
export const FRONTEND_BASE = env('E2E_BASE_URL', 'http://localhost:5173');

export type Persona = {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
};

// Credentials come from `instance/test.env`, the same file
// `instance/scripts/utils/fixtures.py` reads, so the browser suite and the
// Python harnesses cannot disagree about who the personas are. The literals are
// the fallback for a checkout without one.

export const REGULAR_USER: Persona = {
  email: env('E2E_REGULAR_EMAIL', 'regular_user@example.com'),
  password: env('E2E_REGULAR_PASSWORD', 'Regular123!'),
  firstName: 'Regular',
  lastName: 'User',
};

export const POWER_USER: Persona = {
  email: env('E2E_POWER_EMAIL', 'power_user@example.com'),
  password: env('E2E_POWER_PASSWORD', 'Power123!'),
  firstName: 'Power',
  lastName: 'User',
};

export const VIEWER: Persona = {
  email: env('E2E_VIEWER_EMAIL', 'viewer@example.com'),
  password: env('E2E_VIEWER_PASSWORD', 'Viewer123!'),
  firstName: 'Viewer',
  lastName: 'Only',
};

/**
 * Seconds DRF asks us to wait, out of a 429 body.
 *
 * `{"detail": "Request was throttled. Expected available in 6 seconds."}` --
 * the number is the only way to wait the right amount rather than guessing.
 */
function throttleWaitSeconds(body: string): number {
  const m = /available in (\d+(?:\.\d+)?) seconds?/i.exec(body);
  return m ? Math.ceil(parseFloat(m[1])) + 1 : 5;
}

/**
 * POST that waits out a throttle instead of failing on it.
 *
 * Auth is rate-limited by design (`login` 5/minute, `register` 3/minute in
 * `settings/base.py`), and that limit is a *feature* the adversarial harness
 * asserts on -- so the browser harness has to live within it rather than have
 * it raised. A real user does not sign in nineteen times a minute; the suite
 * does, so it waits.
 */
async function postWithThrottleRetry(
  request: APIRequestContext,
  url: string,
  data: Record<string, unknown>,
  attempts = 4,
) {
  const headers = testClientHeaders();
  let res = await request.post(url, { data, headers });
  for (let i = 0; i < attempts && res.status() === 429; i++) {
    const wait = throttleWaitSeconds(await res.text());
    await new Promise((r) => setTimeout(r, wait * 1000));
    res = await request.post(url, { data, headers });
  }
  return res;
}

/**
 * Token cache, keyed by persona email.
 *
 * Every scenario signs in, and without this each one costs a fresh round trip
 * to the auth endpoints -- which is what tripped the throttle below.
 */
const tokenCache = new Map<string, { access: string; refresh: string }>();

/**
 * Log in via API -- returns {access, refresh}. Registers only if the persona
 * does not exist yet.
 *
 * Order matters, and it used to be the other way round. Trying *register*
 * first meant all 19 scenarios hammered `POST /api/auth/register/`, which is
 * throttled (`core/http/throttling.py`; the adversarial harness pins the 429
 * after six attempts). The sixth scenario onwards died with
 * `register failed 429: Request was throttled`, and because the fallback to
 * login only triggered on a 400, a 429 threw instead of recovering -- 13 of 19
 * scenarios failed for a reason that had nothing to do with what they test.
 *
 * The personas are seeded by `instance/scripts/seed_instance.py`, so logging in
 * is both the normal path and one request instead of two. Register survives as
 * the fallback for a fresh database that has not been seeded yet.
 */
export async function registerOrLogin(
  request: APIRequestContext,
  persona: Persona,
): Promise<{ access: string; refresh: string }> {
  const cached = tokenCache.get(persona.email);
  if (cached) return cached;

  const login = await postWithThrottleRetry(request, `${API_BASE}/api/auth/login/`, {
    email: persona.email,
    password: persona.password,
  });
  if (login.ok()) {
    const body = await login.json();
    const tokens = { access: body.access, refresh: body.refresh };
    tokenCache.set(persona.email, tokens);
    return tokens;
  }

  // Not seeded yet -- create the persona, then use it.
  const reg = await postWithThrottleRetry(request, `${API_BASE}/api/auth/register/`, {
    username: persona.email,
    email: persona.email,
    password: persona.password,
    password2: persona.password,
    first_name: persona.firstName ?? 'Instance',
    last_name: persona.lastName ?? 'User',
  });
  if (reg.ok()) {
    const body = await reg.json();
    const tokens = { access: body.access, refresh: body.refresh };
    tokenCache.set(persona.email, tokens);
    return tokens;
  }

  const txt = await reg.text();
  throw new Error(
    `could not sign in as ${persona.email}: login ${login.status()}, ` +
    `register ${reg.status()}: ${txt.slice(0, 400)}. ` +
    `Run: python instance/scripts/seed_instance.py`,
  );
}

/**
 * Inject JWTs into localStorage before any page navigation.
 * Must be called before page.goto().
 *
 * better-n8n-frontend/src/api/client.ts reads localStorage access_token / refresh_token
 * via tokenManager; AuthContext checks isAuthenticated from GET /api/auth/profile/.
 */
export async function injectAuth(page: Page, tokens: { access: string; refresh: string }): Promise<void> {
  await page.addInitScript(
    ({ access, refresh }) => {
      localStorage.setItem('access_token', access);
      localStorage.setItem('refresh_token', refresh);
      // Some builds also read 'token' — keep compat
      localStorage.setItem('token', access);
    },
    tokens,
  );
}

/**
 * One-liner: registerOrLogin + injectAuth.
 * Call at the top of each test, before page.goto().
 */
export async function signInAs(
  page: Page,
  request: APIRequestContext,
  persona: Persona = REGULAR_USER,
): Promise<{ access: string; refresh: string }> {
  const tokens = await registerOrLogin(request, persona);
  await injectAuth(page, tokens);
  return tokens;
}

/**
 * Assert the shell shows an authenticated state — Sidebar has nav, no redirect to /login.
 */
export async function expectAuthenticated(page: Page): Promise<void> {
  // Sidebar renders nav links: Ask, Overview, Runs, Agents, etc.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 5_000 });
  // At least one work nav is visible (Ask → /ai-chat)
  const ask = page.getByRole('link', { name: /ask/i }).first();
  // fallback: any sidebar link
  const anyLink = page.locator('nav a, aside a').first();
  await expect(ask.or(anyLink)).toBeVisible({ timeout: 10_000 });
}

/**
 * Log out via UI (Settings → Sign Out) — used by auth specs that need a logged-out state after.
 */
export async function signOutViaUI(page: Page): Promise<void> {
  // Settings is at /settings; sign out button there has LogOut icon
  await page.goto('/settings');
  const signOut = page.getByRole('button', { name: /sign out|log ?out/i });
  if (await signOut.count()) {
    await signOut.click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  } else {
    // fallback: clear storage
    await page.evaluate(() => localStorage.clear());
    await page.goto('/login');
  }
}
