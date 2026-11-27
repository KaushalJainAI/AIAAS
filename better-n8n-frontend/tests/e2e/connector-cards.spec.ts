/**
 * API connector cards that are not built yet (free: no model calls).
 *
 * Todoist and Cal.com are seeded as API cards with `coming_soon=True`. The
 * page must show them as "Coming soon", switch them off and inert, and offer no
 * Connect button, because a card that looks connectable and then fails is the
 * worst outcome here.
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

/**
 * The whole card around one connector's name: the nearest ancestor that is a
 * flex column and holds that card's own switch. Going up from the name by tag
 * would stop at the title row, which does not contain the status badge.
 */
function cardFor(page: import('@playwright/test').Page, name: string) {
  return page.locator(
    `xpath=//p[normalize-space(.)="${name}"]/ancestor::div[contains(@class,"flex-col") and .//*[@role="switch"]][1]`,
  );
}

test.describe('API connector cards — happy', () => {
  for (const name of ['Todoist', 'Cal.com']) {
    test(`${name} shows Coming soon`, async ({ page }) => {
      await signIn(page, account);
      await page.goto('/connections');
      const card = cardFor(page, name);
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card.getByText('Coming soon', { exact: true })).toBeVisible();
    });
  }
});

test.describe('API connector cards — sad', () => {
  for (const name of ['Todoist', 'Cal.com']) {
    test(`${name} cannot be switched on or connected`, async ({ page }) => {
      await signIn(page, account);
      await page.goto('/connections');
      const card = cardFor(page, name);
      await expect(card).toBeVisible({ timeout: 15_000 });
      // The switch is disabled, so a click must not move it. The API answers
      // 409 to a platform-off row, which is why the UI must not offer it.
      const toggle = card.getByRole('switch');
      await expect(toggle).toBeDisabled();
      await expect(card.getByRole('button', { name: /^connect$/i })).toHaveCount(0);
    });
  }
});
