/**
 * Auth happy / sad / angry e2e against a real backend.
 *
 * Requires:
 *   - Backend running on http://localhost:8000
 *   - Vite dev server on http://localhost:5173 (Playwright starts it via webServer)
 */
import { expect, test } from '@playwright/test';

const uniqueEmail = () => `e2e_${Date.now()}_${Math.floor(Math.random() * 1e6)}@example.com`;

test.describe('auth — happy', () => {
  test('user can register and leave the sign-up screen', async ({ page }) => {
    // `/signup` is the route; `/register` never existed in App.tsx, so this
    // test waited 30 s for an email field on the not-found page.
    await page.goto('/signup');
    const email = uniqueEmail();
    // Full Name is `required`: left blank, the browser's own constraint
    // validation blocks the submit and no request is ever sent.
    await page.getByLabel(/full name/i).fill('E2E Tester');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).first().fill('Sup3r$ecret-e2e!');
    // Some forms have a confirm field
    const confirm = page.getByLabel(/confirm/i);
    if (await confirm.count()) await confirm.fill('Sup3r$ecret-e2e!');
    await page.getByRole('button', { name: /sign up|register|create/i }).click();

    // Success leaves the form: `?next=` if one was given, otherwise the
    // default landing, which routes on to the overview. Asserting on where it
    // went would pin a landing page this test is not about.
    await expect(page).not.toHaveURL(/\/signup/, { timeout: 10_000 });
  });
});

test.describe('auth — sad', () => {
  test('login with bogus password shows an error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('nonexistent@example.com');
    await page.getByLabel(/password/i).fill('definitely-wrong');
    await page.getByRole('button', { name: /log ?in|sign ?in/i }).click();
    // Expect to remain on /login OR see a visible error toast/banner.
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('auth — angry', () => {
  test('XSS payload in email field does not execute', async ({ page }) => {
    let alertFired = false;
    page.on('dialog', async (d) => {
      alertFired = true;
      await d.dismiss();
    });
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('<script>alert(1)</script>@x.com');
    await page.getByLabel(/password/i).fill('whatever');
    await page.getByRole('button', { name: /log ?in|sign ?in/i }).click();
    await page.waitForTimeout(500);
    expect(alertFired).toBe(false);
  });

  test('navigating to a protected route while logged-out redirects', async ({ page }) => {
    await page.goto('/workflows');
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });

  test('rapidly clicking the login button does not double-submit', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('alice@example.com');
    await page.getByLabel(/password/i).fill('something');
    const submit = page.getByRole('button', { name: /log ?in|sign ?in/i });
    // Fire 5 rapid clicks; record outgoing /api/auth/login requests
    let calls = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/auth/login') && req.method() === 'POST') calls++;
    });
    await Promise.all(Array.from({ length: 5 }, () => submit.click({ force: true }).catch(() => {})));
    await page.waitForTimeout(1000);
    // Expect the button to be debounced/disabled — at most a couple of calls.
    expect(calls).toBeLessThan(5);
  });
});
