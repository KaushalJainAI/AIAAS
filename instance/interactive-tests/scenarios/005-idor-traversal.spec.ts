/**
 * 005 — IDOR & traversal — browser + API
 *
 * Two real users (A=regular, B=power) are created via API, then A's browser
 * tries to reach B's agents/folders/docs via URL manipulation and via UI
 * navigation. All must get 404 oracle-safe (not 403 that reveals existence)
 * or be hidden by LiveManager.
 */
import { test, expect } from '@playwright/test';
import { signInAs, REGULAR_USER, POWER_USER } from '../helpers/auth';
import { createFolder } from '../helpers/seed';

const API = process.env.E2E_API_URL ?? 'http://localhost:8000';

test.describe('IDOR & traversal', () => {
  test('A cannot view or edit B agent via URL', async ({ page, request, browser }) => {
    // create B agent via API with B credentials
    const { access: bAccess } = await (await import('../helpers/auth')).registerOrLogin(request, POWER_USER);
    const r = await request.post(`${API}/api/orchestrator/agents/`, {
      headers: { Authorization: `Bearer ${bAccess}`, 'Content-Type': 'application/json' },
      data: { name: `Victim ${Date.now() % 100000}`, brief: 'victim', provider: 'nvidia', model: 'openai/gpt-oss-20b' },
    });
    expect(r.ok()).toBeTruthy();
    const victim = await r.json();
    const victimId = victim.id;

    // now sign in as A in the browser
    await signInAs(page, request, REGULAR_USER);
    // try to open B agent in builder
    await page.goto(`/agents/${victimId}`);
    // either redirected /agents or shows 404/error — never shows B agent name
    await page.waitForTimeout(1500);
    const url = page.url();
    const body = await page.locator('body').innerText();
    // must not leak victim name
    expect(body).not.toContain(victim.name);
    // URL should be /agents or /login or still /agents/:id but with error UI
    expect(url).toMatch(/\/agents|\/login/);
  });

  test('A cannot move into B folder (API + UI)', async ({ page, request }) => {
    const { access: bAccess } = await (await import('../helpers/auth')).registerOrLogin(request, POWER_USER);
    const { access: aAccess } = await (await import('../helpers/auth')).registerOrLogin(request, REGULAR_USER);

    const bFolder = await createFolder(request, bAccess, `victim-${Date.now() % 100000}`);
    const aFolderRes = await request.post(`${API}/api/inference/folders/`, {
      headers: { Authorization: `Bearer ${aAccess}`, 'Content-Type': 'application/json' },
      data: { name: `own-${Date.now() % 100000}` },
    });
    expect(aFolderRes.ok()).toBeTruthy();
    const aFolder = await aFolderRes.json();

    // try via API as A
    const move = await request.post(`${API}/api/inference/fs/move/`, {
      headers: { Authorization: `Bearer ${aAccess}`, 'Content-Type': 'application/json' },
      data: { folder_ids: [aFolder.id], document_ids: [], target_folder_id: bFolder.id },
    });
    // expect 404 oracle-safe or 400, never 200 leak
    expect([404, 400].includes(move.status())).toBeTruthy();

    // UI: A should not see B folder in picker
    await signInAs(page, request, REGULAR_USER);
    await page.goto('/documents');
    await expect(page.locator('body')).not.toContainText(bFolder.name);
  });

  test('protected route while logged out redirects to login', async ({ page }) => {
    await page.goto('/agents');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    await page.goto('/documents');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    await page.goto('/runs');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });
});
