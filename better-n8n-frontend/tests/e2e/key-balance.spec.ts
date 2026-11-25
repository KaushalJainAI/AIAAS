/**
 * The OpenRouter balance line with a fake key (free: no model calls).
 *
 * A fake key is rejected by OpenRouter (or cannot be reached from CI), so the
 * balance endpoint answers 200 with `available: false` and a reason. The page
 * must show that reason in the card. It must not crash, and must not fall back
 * to the generic "Could not check the balance." line, which means the request
 * itself failed.
 *
 * Nothing is mocked: the real backend calls OpenRouter. The key is fake and
 * deleted at the end, so no real money is involved.
 */
import { expect, test } from '@playwright/test';

import { API, apiAs, registerAccount, signIn, type Account } from './helpers/session';

const FAKE_KEY = 'sk-or-v1-e2e-fake';

/** The backend's own reasons for "no balance" (llm/balance.py). */
const BACKEND_REASON =
  /OpenRouter rejected this key|OpenRouter did not answer|Could not reach OpenRouter|OpenRouter returned HTTP|rate limiting|could not be read/i;

let account: Account;

test.beforeAll(async () => {
  account = await registerAccount();
});

test.describe('key balance — sad', () => {
  test('a fake OpenRouter key shows the reason, not a broken row', async ({ page }) => {
    const api = await apiAs(account.access);
    const name = `e2e-fake-key-${Date.now()}`;
    let credentialId: number | null = null;
    try {
      const types = await api.get(`${API}/api/credentials/types/`);
      const { types: list } = (await types.json()) as { types: { id: number; slug: string }[] };
      const openrouter = list.find((t) => t.slug === 'openrouter');
      if (!openrouter) throw new Error('no openrouter credential type seeded');

      const created = await api.post(`${API}/api/credentials/`, {
        data: { name, credential_type: openrouter.id, data: { apiKey: FAKE_KEY } },
      });
      expect(created.status(), 'creating a fake key should succeed').toBe(201);
      credentialId = ((await created.json()) as { id: number }).id;

      await signIn(page, account);
      await page.goto('/credentials');

      // The row's own card: the nearest ancestor that holds this key's
      // "Check balance" button, found from the credential's name.
      const card = page.locator(
        `xpath=//*[normalize-space(.)="${name}"]/ancestor::div[.//button[normalize-space(.)="Check balance"]][1]`,
      );
      await expect(card).toBeVisible({ timeout: 15_000 });
      await card.getByRole('button', { name: 'Check balance' }).click();

      const line = card.getByTestId('credential-balance');
      await expect(line).toBeVisible({ timeout: 20_000 });
      await expect(line).toHaveText(BACKEND_REASON);
      await expect(line).not.toHaveText(/Could not check the balance/);
    } finally {
      if (credentialId !== null) {
        await api.delete(`${API}/api/credentials/${credentialId}/`);
      }
      await api.dispose();
    }
  });
});
