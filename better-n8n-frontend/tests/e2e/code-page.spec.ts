/**
 * The /code placeholder (free: no model calls).
 *
 * The `/code` slash command lands here. The coding workspace is not built, so
 * the page must say so in plain words and offer a way back to chat. The
 * failure this guards against is the one that shipped before: the route was
 * missing and a signed-in user hit the generic NotFound page instead.
 */
import { expect, test } from '@playwright/test';

import { registerAccount, signIn, type Account } from './helpers/session';

let account: Account;

test.beforeAll(async () => {
  // Production rate-limits sign-ups (3 a minute); registerAccount waits out a
  // 429 for 65 s, longer than the default 30 s hook timeout.
  test.setTimeout(150_000);
  account = await registerAccount();
});

test.describe('/code placeholder — happy', () => {
  test('a signed-in user sees the not-available message, not NotFound', async ({ page }) => {
    await signIn(page, account);
    await page.goto('/code');
    await expect(page.getByText(/not available yet/i)).toBeVisible({ timeout: 15_000 });
  });

  test('the back-to-chat link returns the user to chat', async ({ page }) => {
    await signIn(page, account);
    await page.goto('/code');
    const back = page.getByRole('link', { name: /back to chat/i });
    await expect(back).toBeVisible({ timeout: 15_000 });
    await back.click();
    await expect(page).toHaveURL(/\/ai-chat/, { timeout: 10_000 });
  });
});

test.describe('/code placeholder — sad', () => {
  test('a signed-out visitor is sent to log in, not shown the page', async ({ page }) => {
    // The route sits behind ProtectedRoute like every app page. Without tokens
    // the placeholder must not render at all.
    await page.goto('/code');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(page.getByText(/not available yet/i)).toHaveCount(0);
  });
});
