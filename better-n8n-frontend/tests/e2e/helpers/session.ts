/**
 * Sign-in without the login form.
 *
 * Every spec that needs a signed-in user registers a throwaway account through
 * the API and puts the tokens where the app reads them, so the test starts on
 * the page it is about instead of clicking through /login each time.
 *
 * The app keeps its tokens in localStorage under `access_token` and
 * `refresh_token` (see `src/api/client.ts`, `tokenManager`). Playwright's
 * `addInitScript` writes them before any page script runs, on every navigation.
 */
import { request, type APIRequestContext, type Page } from '@playwright/test';

/** Where the API lives. Same-origin dev server by default; production via env. */
export const API = process.env.E2E_API_URL ?? 'http://localhost:8000';

/** Meets the backend's password rules; the same value every spec uses. */
export const PASSWORD = 'Sup3r$ecret-e2e!';

export interface Account {
  email: string;
  access: string;
  refresh: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Register a fresh throwaway account and log it in.
 *
 * Registration is throttled (3 a minute per address in settings/base.py). A
 * spec file mints its account once in `beforeAll`, but several files and the
 * live specs can still land in the same minute, so a 429 waits and retries
 * instead of failing the test for the throttle rather than for anything real.
 */
export async function registerAccount(): Promise<Account> {
  const ctx = await request.newContext({ baseURL: API });
  try {
    const id = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const email = `e2e_${id}@example.com`;
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await ctx.post(`${API}/api/auth/register/`, {
        data: { username: `e2e_${id}`, email, password: PASSWORD, password2: PASSWORD },
      });
      if (r.status() !== 429) break;
      await sleep(65_000);
    }
    let login = await ctx.post(`${API}/api/auth/login/`, { data: { email, password: PASSWORD } });
    if (login.status() === 429) {
      await sleep(65_000);
      login = await ctx.post(`${API}/api/auth/login/`, { data: { email, password: PASSWORD } });
    }
    if (!login.ok()) {
      throw new Error(`login after register failed: HTTP ${login.status()}`);
    }
    const body = (await login.json()) as { access?: string; refresh?: string };
    if (!body.access || !body.refresh) throw new Error('login response had no tokens');
    return { email, access: body.access, refresh: body.refresh };
  } finally {
    await ctx.dispose();
  }
}

/** Put an account's tokens in localStorage before the first script runs. */
export async function signIn(page: Page, account: Account): Promise<void> {
  await page.addInitScript(
    ({ access, refresh }) => {
      localStorage.setItem('access_token', access);
      localStorage.setItem('refresh_token', refresh);
    },
    { access: account.access, refresh: account.refresh },
  );
}

/**
 * An API client signed in as an account. Callers dispose it when done.
 * Absolute URLs only: the context has no base URL, so a relative path would
 * silently go to the wrong host.
 */
export async function apiAs(token: string): Promise<APIRequestContext> {
  return request.newContext({
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    timeout: 60_000,
  });
}
