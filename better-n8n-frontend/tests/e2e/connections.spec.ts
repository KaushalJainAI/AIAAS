/**
 * Connections page e2e.
 *
 * Replaces connectors.spec.ts: `/connectors` and `/mcp-servers` were merged into
 * `/connections`, so the old paths are now redirects — which these tests assert,
 * since stale links and bookmarks are the main risk of a route rename.
 */
import { expect, request, test } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:8000';

async function freshLogin() {
  const ctx = await request.newContext();
  const id = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const email = `e2e_${id}@example.com`;
  const password = 'Sup3r$ecret-e2e!';
  await ctx.post(`${API}/api/auth/register/`, {
    data: { username: `e2e_${id}`, email, password, password2: password },
  });
  const r = await ctx.post(`${API}/api/auth/login/`, { data: { email, password } });
  const body = await r.json();
  return body.access ?? body.access_token;
}

/* One account for the whole file, minted once — the same rule
   mobile-layout.spec.ts follows. Registering per test runs straight into the
   register throttle (3/minute in settings/base.py), and every test after the
   third then fails on the login screen rather than on anything about
   Connections. */
let TOKEN = '';
test.beforeAll(async () => {
  TOKEN = await freshLogin();
});

async function signedIn(page: import('@playwright/test').Page) {
  await page.addInitScript((t) => localStorage.setItem('access_token', t), TOKEN);
}

test.describe('Connections page — happy', () => {
  test('lists at least one curated connection', async ({ page }) => {
    await signedIn(page);
    await page.goto('/connections');
    // Display names come from the database now, so match on brands (stable)
    // rather than on the built-ins, whose labels are ours to reword.
    await expect(
      // `visible: true`: the first text match in the DOM can be a hidden one.
      page.getByText(/Notion|Google Drive|Slack|Gmail|Google Calendar/i).filter({ visible: true }).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('groups connections under category headings', async ({ page }) => {
    await signedIn(page);
    await page.goto('/connections');
    await expect(
      page.getByRole('heading', { name: /Google Workspace|Built in/i }).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('does not offer adding a custom MCP server', async ({ page }) => {
    // Custom servers are retired behind CUSTOM_MCP_SERVERS / the backend's
    // MCP_CUSTOM_SERVERS_ENABLED (H-175): connectors come from the curated
    // catalogue only, so neither the Advanced disclosure nor its button shows.
    await signedIn(page);
    await page.goto('/connections');
    await expect(page.getByText(/Google Workspace/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Advanced', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Add custom server', { exact: true })).toHaveCount(0);
  });

  test('turning a curated connection off does not fail with 403', async ({ page }) => {
    await signedIn(page);
    const failures: string[] = [];
    page.on('response', (res) => {
      if (res.url().includes('/api/mcp/servers/') && res.status() >= 400) {
        failures.push(`${res.status()} ${res.request().method()} ${res.url()}`);
      }
    });

    await page.goto('/connections');
    const toggle = page.getByRole('switch').first();
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    const wasOn = await toggle.getAttribute('aria-checked');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', wasOn === 'true' ? 'false' : 'true');
    expect(failures, `unexpected API failures: ${failures.join(', ')}`).toEqual([]);
  });
});

test.describe('Connections page — redirects', () => {
  for (const legacy of ['/connectors', '/mcp-servers']) {
    test(`${legacy} redirects to /connections`, async ({ page }) => {
      await signedIn(page);
      await page.goto(legacy);
      await expect(page).toHaveURL(/\/connections$/, { timeout: 10_000 });
    });
  }
});

test.describe('Connections page — angry', () => {
  test('survives an empty server list', async ({ page }) => {
    await signedIn(page);
    await page.route('**/api/mcp/servers/', (route) =>
      route.fulfill({
        status: 200,
        body: JSON.stringify({ servers: [] }),
        contentType: 'application/json',
      })
    );
    await page.goto('/connections');
    await expect(page.getByText(/No connections available/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test('survives a malformed payload', async ({ page }) => {
    await signedIn(page);
    await page.route('**/api/mcp/servers/', (route) =>
      route.fulfill({ status: 200, body: '[]', contentType: 'application/json' })
    );
    await page.goto('/connections');
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('surfaces a backend 500 instead of an empty screen', async ({ page }) => {
    await signedIn(page);
    await page.route('**/api/mcp/servers/', (route) =>
      route.fulfill({
        status: 500,
        body: '{"detail":"boom"}',
        contentType: 'application/json',
      })
    );
    await page.goto('/connections');
    // react-query retries three times with backoff before surfacing the error,
    // so the banner legitimately takes longer than a normal assertion window.
    await expect(page.getByText(/Could not load your connections/i)).toBeVisible({
      timeout: 25_000,
    });
  });
});
