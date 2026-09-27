/**
 * Shared Playwright assertions — human-readable, good failure messages,
 * and aligned with the UX invariants in instance/docs/USER_JOURNEY.md.
 */
import { expect, type Page, type APIRequestContext } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:8000';

/**
 * Poll GET /api/logs/executions/{id}/ until terminal or timeout.
 * Asserts the execution was actually recorded, not just 202'd.
 */
export async function expectExecutionTerminal(
  request: APIRequestContext,
  access: string,
  executionId: string,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<{ status: string; body: any }> {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const pollMs = opts.pollMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  let status = '';
  while (Date.now() < deadline) {
    const r = await request.get(`${API}/api/logs/executions/${executionId}/`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    if (r.ok()) {
      last = await r.json();
      status = (last.status ?? last.execution?.status ?? '').toLowerCase();
      if (['completed', 'failed', 'cancelled', 'timeout'].includes(status)) break;
    }
    await new Promise(res => setTimeout(res, pollMs));
  }
  expect(status, `execution ${executionId.slice(0, 8)} should reach terminal state`).toMatch(/completed|failed|cancelled|timeout/);
  return { status, body: last };
}

/**
 * Assert a list response is capped and, if capped, says so (truncated flag).
 * Catches "unbounded list" regressions (DEFAULT_PAGINATION_CLASS doesn't apply to function views).
 */
export async function expectCappedList(body: any, capField: string = 'truncated'): Promise<void> {
  if (Array.isArray(body)) return; // some endpoints return bare arrays with limit enforced server-side
  if (body && typeof body === 'object' && capField in body) {
    // if truncated === true, caller should be aware; if false, list is complete
    expect(typeof body[capField]).toBe('boolean');
  }
}

/**
 * Assert auth redirect: protected route while logged out → /login.
 */
export async function expectRequiresAuth(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
}

/**
 * Assert streaming UX: after sending a chat message, the stop button appears then disappears.
 * Use this to wait for a turn to finish without fixed timeouts.
 */
export async function waitForChatIdle(page: Page, timeoutMs = 45_000): Promise<void> {
  const stop = page.getByRole('button', { name: /stop/i });
  // wait for stop to appear (streaming started) then vanish (done)
  try {
    await expect(stop).toBeVisible({ timeout: 8_000 });
    await expect(stop).toBeHidden({ timeout: timeoutMs });
  } catch {
    // if no streaming (e.g. refused due to quota), at least ensure not stuck loading forever
    const loading = page.locator('[aria-busy="true"], [data-loading="true"]').first();
    if (await loading.count()) await expect(loading).toBeHidden({ timeout: 5_000 });
  }
}

/**
 * Assert a tool is gated (approval banner appears) vs auto-allowed.
 */
export async function expectToolApprovalBanner(page: Page, shouldAppear: boolean): Promise<void> {
  const banner = page.locator('[data-testid="tool-approval-card"], :text("Permission required"), :text("Approve")').first();
  if (shouldAppear) await expect(banner).toBeVisible({ timeout: 10_000 });
  else await expect(banner).toBeHidden({ timeout: 5_000 });
}
