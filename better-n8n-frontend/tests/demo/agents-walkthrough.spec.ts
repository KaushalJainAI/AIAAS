/**
 * Walkthrough recording: four agents with everyday utility, and one of them
 * actually running to completion.
 *
 * This is a recording, not an assertion suite. It still asserts at each step,
 * because a video of a page that silently failed to load is worse than no
 * video — but the pacing (`beat`) exists for the viewer, not the runner.
 */
import { test, expect, Page } from '@playwright/test';

const EMAIL = process.env.DEMO_EMAIL ?? 'demo@aiaas.dev';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo@2026';
const AGENTS = ['Morning Briefing', 'Research Analyst', 'Data Analyst', 'Invoice Auditor'];

/** A pause long enough to read what just happened. */
const beat = (page: Page, ms = 1800) => page.waitForTimeout(ms);

/** Scroll slowly enough that the video can be followed. */
async function pan(page: Page, steps = 3, dy = 420) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy);
    await beat(page, 1500);
  }
}

test('agents walkthrough', async ({ page }) => {
  // ── Sign in ────────────────────────────────────────────────────────────
  await page.goto('/login');
  await beat(page, 1500);
  await page.getByPlaceholder('name@example.com').fill(EMAIL);
  await beat(page, 600);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await beat(page, 700);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90_000 });
  await beat(page, 2200);

  // ── The agents ─────────────────────────────────────────────────────────
  await page.goto('/agents');
  await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
  for (const name of AGENTS) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  await beat(page, 3000);
  await pan(page, 2, 380);
  await beat(page, 1500);

  // ── One agent's configuration ──────────────────────────────────────────
  await page.getByText('Invoice Auditor', { exact: true }).first().click();
  await page.waitForURL(/\/agents\/\d+/, { timeout: 60_000 });
  await beat(page, 3000);
  await pan(page, 4, 380);
  await beat(page, 1500);

  // ── Schedules, and a real run ──────────────────────────────────────────
  await page.goto('/schedules');
  await beat(page, 3000);
  const runNow = page.getByRole('button', { name: /run now/i }).first();
  await expect(runNow).toBeVisible({ timeout: 60_000 });
  await beat(page, 1500);
  await runNow.click();
  await beat(page, 5000);

  // ── Wait for THIS run to finish, not merely for some run to exist ──────
  await page.goto('/runs');
  await beat(page, 2500);
  // The Runs list renders each run as a <button>, not a table row — getByRole
  // ('row') matches nothing here. The list is empty apart from this run, so
  // waiting for the success label is unambiguous.
  const succeeded = page.getByText('Succeeded', { exact: true });

  for (let i = 0; i < 40; i++) {
    if (await succeeded.count()) break;
    await beat(page, 5000);
    await page.reload();
    await beat(page, 1500);
  }
  await expect(succeeded.first()).toBeVisible({ timeout: 60_000 });
  await beat(page, 3000);

  // ── What it produced ───────────────────────────────────────────────────
  await page.locator('button').filter({ hasText: 'Invoice Auditor' }).first().click();
  await beat(page, 4000);
  await pan(page, 5, 420);
  await beat(page, 3000);
});
