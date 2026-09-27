import { test, expect } from '@playwright/test';
import { REGULAR_USER, API_BASE } from '../helpers/auth';
import { testClientHeaders } from '../helpers/testenv';

test('debug chat', async ({ page, request }) => {
  test.setTimeout(120_000);
  const r = await request.post(`${API_BASE}/api/auth/login/`, { data: { email: REGULAR_USER.email, password: REGULAR_USER.password }, headers: testClientHeaders() });
  const { access, refresh } = await r.json();
  await page.addInitScript(([a, b]) => { localStorage.setItem('access_token', a); localStorage.setItem('refresh_token', b); }, [access, refresh]);
  page.on('response', s => { if (s.url().includes('/api/chat')) console.log('RES', s.status(), s.url().split('/api')[1]); });
  await page.goto('/ai-chat');
  const composer = page.locator('textarea[name="chat-input"]');
  await expect(composer).toBeVisible({ timeout: 15000 });
  await composer.click();
  await page.keyboard.type('In one sentence, what can you help me with?', { delay: 10 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(20000);
  const body = await page.locator('body').innerText().catch(() => '');
  console.log('BODY TEXT:', JSON.stringify(body.slice(0, 1400)));
});
