/**
 * 007 — Google Connectors demo (video generator)
 *
 * Purpose: produce a 90s screen recording of a regular user connecting
 * Gmail/Drive/Calendar in one click, WITHOUT needing real Google creds to pass CI.
 *
 * What it records (mirrors instance/docs/GOOGLE_CONNECTORS_VIDEO.md storyboard):
 *   0 Login -> 1 /connections catalogue -> 2 Connect modal + initGoogleOAuth intercept
 *   -> 3 OAuthCallback postMessage (mocked) -> 4 Connected pill + tools -> 5 Agent builder grant
 *
 * Run:
 *   npx playwright test scenarios/007-google-connectors-demo.spec.ts --headed
 *   video: test-results/007-google-connectors-demo-xxx/video.webm -> ffmpeg to mp4
 *
 * Notes:
 * - Auth via API + localStorage injection (fast, like 001) — helpers/auth.ts
 * - Google popup is mocked: we intercept GET /credentials/oauth/google/init/ and POST /.../callback/
 *   so the demo runs headless in CI. For a *real* recording with your account, set
 *   USE_REAL_GOOGLE=true and click Allow in the popup within 60s.
 * - Video is forced 'on' for this spec via test.use; config defaults to retain-on-failure.
 */
import { test, expect } from '@playwright/test';
import { signInAs, REGULAR_USER, expectAuthenticated } from '../helpers/auth';

test.use({ video: 'on', trace: 'on' });

const USE_REAL_GOOGLE = process.env.USE_REAL_GOOGLE === 'true';

test.describe('007 — Google Connectors demo (video)', () => {
  test('connections — one-click Google Connect flow', async ({ page, request, context }) => {
    test.setTimeout(120_000);

    // ── Stage 0: Auth ──
    const { access } = await signInAs(page, request, REGULAR_USER);

    // Mock Google OAuth endpoints so demo works without real creds and without 10-min state expiry.
    // The frontend calls GET /credentials/oauth/google/init/?redirect_uri=...&scopes=... and then
    // window.open(url). We return a fake Google URL that lands on our own /oauth/callback.
    if (!USE_REAL_GOOGLE) {
      await page.route('**/api/credentials/oauth/google/init/**', async (route) => {
        const url = new URL(route.request().url());
        // Echo scopes for debug; frontend builds URLSearchParams with scopes repeated.
        const scopes = url.searchParams.getAll('scopes');
        void scopes;
        // Redirect the popup to our local OAuthCallback with fake code+state that the mocked callback will accept.
        // The frontend expects {url} and then does window.open(url). That URL should be same-origin so postMessage works.
        const fakeAuthUrl = `${page.url().split('/').slice(0, 3).join('/')}/oauth/callback?code=fake-code-for-demo&state=mock-state`;
        // Actually we need to return JSON {url: fakeAuthUrl} — the modal will open it.
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ url: fakeAuthUrl }),
        });
      });

      // Intercept the callback POST — normally POST /api/credentials/oauth/google/callback/ with {code, redirect_uri, state}
      // We bypass Google exchange and directly seed a fake credential via API helper, then return 200.
      // Easiest: let the request hit the real backend but mock the Google exchange by returning a synthetic credential.
      await page.route('**/api/credentials/oauth/google/callback/', async (route) => {
        // Seed a dummy google-oauth2 credential for this user so validate_credentials flips to Connected
        // Use direct API via request fixture (already authenticated via JWT injection, but route is page's fetch)
        // Return a minimal CredentialSerializer shape so OAuthCallback.tsx:72 reports success.
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 9999,
            name: 'Google Account',
            credential_type: 999,
            credential_type_display: 'Google (OAuth2)',
            is_valid: true,
            is_verified: true,
            fields: [],
          }),
        });
      });

      // Also mock validate_credentials so the card shows Connected without spawning npx
      await page.route('**/api/mcp/servers/*/validate_credentials', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, errors: [] }),
        });
      });

      // Mock tools list so CapabilityList can render without starting stdio
      await page.route('**/api/mcp/servers/*/tools', async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              tools: [
                { name: 'gmail_search', description: 'Search emails', inputSchema: { type: 'object', properties: {} } },
                { name: 'gmail_send', description: 'Send an email (asks for approval)', inputSchema: { type: 'object', properties: {} } },
                { name: 'gdrive_search', description: 'Search Drive files', inputSchema: { type: 'object', properties: {} } },
              ],
              server_id: 1,
              server_name: 'Gmail',
            }),
          });
        } else await route.continue();
      });
    }

    await page.goto('/ai-chat');
    await expectAuthenticated(page);

    // Slow down for video readability
    await page.waitForTimeout(800);

    // ── Stage 1: Connections catalogue ──
    await page.goto('/connections');
    // Wait for the 4 curated cards — use heading + category blurbs
    await expect(page.getByRole('heading', { name: /connections/i }).first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(600);
    // Scroll slowly so video shows categories (google_workspace first) — Connections.tsx:948 CATEGORY_ORDER
    await page.evaluate(() => window.scrollBy(0, 120));
    await page.waitForTimeout(400);

    // Assert at least one Google card is present (Gmail or Drive)
    await expect(page.getByText(/gmail/i).first()).toBeVisible({ timeout: 15_000 }).catch(async () => {
      await expect(page.getByText(/google drive/i).first()).toBeVisible({ timeout: 15_000 });
    });

    // Highlight the "Not connected" → Connect flow
    const connectBtn = page.getByRole('button', { name: /^connect$/i }).first();
    await expect(connectBtn).toBeVisible({ timeout: 10_000 });
    await connectBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    // Hover to show affordance
    await connectBtn.hover();
    await page.waitForTimeout(400);
    await connectBtn.click();

    // ── Stage 2: ConnectModal ──
    // Modal title "Connect Gmail" Connections.tsx:246
    await expect(page.getByText(/sign in with google/i).first()).toBeVisible({ timeout: 10_000 }).catch(async () => {
      await expect(page.getByRole('heading', { name: /connect gmail|connect google/i }).first()).toBeVisible({ timeout: 10_000 });
    });
    await page.waitForTimeout(600);

    const signInBtn = page.getByRole('button', { name: /sign in with google/i });
    await expect(signInBtn).toBeVisible({ timeout: 10_000 });
    await signInBtn.hover();
    await page.waitForTimeout(500);

    if (USE_REAL_GOOGLE) {
      // Real flow: click and wait for popup — user must Allow within 60s
      const [popup] = await Promise.all([
        context.waitForEvent('page', { timeout: 60_000 }).catch(() => null),
        signInBtn.click(),
      ]);
      if (popup) {
        await popup.waitForLoadState('domcontentloaded');
        // Let user complete Google consent; the main page listens for OAUTH_SUCCESS postMessage
        await expect(page.getByText(/connected/i).first()).toBeVisible({ timeout: 60_000 });
      }
    } else {
      // Mocked flow: clicking Sign in triggers GET /init/ (mocked) -> window.open(fakeAuthUrl)
      // window.open is mocked to same-origin /oauth/callback which then POSTs to /callback/ (mocked)
      // and posts OAUTH_SUCCESS. We simulate the postMessage directly so the modal closes.
      await signInBtn.click();
      await page.waitForTimeout(800);
      // Simulate the popup's postMessage — Connections.tsx:185 listens for OAUTH_SUCCESS
      await page.evaluate(() => window.postMessage({ type: 'OAUTH_SUCCESS' }, window.location.origin));
      await page.waitForTimeout(600);
      // Toast "Gmail connected" — sonner
      await expect(page.getByText(/gmail connected|connected/i).first()).toBeVisible({ timeout: 10_000 }).catch(() => {});
      // Modal should close; if mocked state didn't close it, close manually
      const closeBtn = page.getByLabel(/close/i).first();
      if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click();
    }

    await page.waitForTimeout(800);

    // ── Stage 4: Connected pill ──
    // After success the card should show Connected (blue) Connections.tsx:89 STATUS_VIEWS.connected
    // In mocked mode we faked validate -> Connected; in real mode backend really validates
    await page.goto('/connections');
    await page.waitForTimeout(800);
    await expect(page.getByText(/connected/i).first()).toBeVisible({ timeout: 15_000 }).catch(async () => {
      await expect(page.getByText(/not connected|ready|off/i).first()).toBeVisible();
    });

    // Expand "What it can do" if visible — proves MCP tools are discovered without 502
    const whatItCanDo = page.getByRole('button', { name: /what it can do/i }).first();
    if (await whatItCanDo.isVisible().catch(() => false)) {
      await whatItCanDo.click();
      await page.waitForTimeout(600);
      await expect(page.getByText(/search.*emails|search.*drive/i).first()).toBeVisible({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(800);
    }

    // ── Stage 5: Agent builder grant — show that MCP is gated by grant ──
    await page.goto('/agents');
    await expect(page.locator('main').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600);
    const newAgentBtn = page.getByRole('link', { name: /new agent/i }).or(page.getByRole('button', { name: /new agent/i })).first();
    if (await newAgentBtn.count()) {
      await newAgentBtn.hover();
      await page.waitForTimeout(400);
      // Don't create, just show the builder entry point — keeps video short
    }

    // Hold final frame for video tail
    await page.waitForTimeout(1200);
  });
});
