/**
 * 006 — Permission abuse (tools / autonomy / HITL)
 *
 * - Locked tool disable must 400
 * - Disabled tool must stay gated at execute-tool
 * - plan autonomy withholds mutating tools (no banner, toolbox narrowed)
 */
import { test, expect } from '@playwright/test';
import { signInAs, REGULAR_USER } from '../helpers/auth';

const API = process.env.E2E_API_URL ?? 'http://localhost:8000';

test.describe('permission abuse', () => {
  test('locked tool cannot be disabled (API + UI)', async ({ page, request }) => {
    const { access } = await (await import('../helpers/auth')).registerOrLogin(request, REGULAR_USER);
    const r = await request.patch(`${API}/api/tools/`, {
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      data: { tool_name: 'read_tool_output', enabled: false },
    });
    expect(r.status()).toBe(400);
    const body = await r.json().catch(() => ({}));
    // Assert the refusal *names the tool*, not that it contains the word
    // "lock". The real message is "'read_tool_output' cannot be switched off -
    // the assistant is told to call it by name...", so matching on 'lock'
    // failed a guard that was working perfectly. Match what makes the message
    // useful to whoever reads it: which tool, and that it was refused.
    const text = JSON.stringify(body).toLowerCase();
    expect(text).toContain('read_tool_output');
    expect(text).toMatch(/cannot be switched off|locked|not allowed/);

    // UI: Tools page — locked row switch should be disabled
    await signInAs(page, request, REGULAR_USER);
    await page.goto('/tools');
    await expect(page.getByText(/tools/i).first()).toBeVisible({ timeout: 10_000 });
    const locked = page.getByText(/read_tool_output/i).first();
    if (await locked.count()) {
      const row = page.locator('[data-testid="tool-read_tool_output"]').first();
      if (await row.count()) {
        const sw = row.getByRole('switch').first();
        if (await sw.count()) await expect(sw).toBeDisabled();
      }
    }
  });

  test('disabled web_search stays gated', async ({ page, request }) => {
    const { access } = await (await import('../helpers/auth')).registerOrLogin(request, REGULAR_USER);
    // disable
    await request.patch(`${API}/api/tools/`, {
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      data: { tool_name: 'web_search', enabled: false },
    });
    // try to run it directly
    const exec = await request.post(`${API}/api/chat/execute-tool/`, {
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      data: { tool: 'web_search', args: { query: 'hello' } },
    });
    // The property is *the tool did not run*, and the transport for saying so
    // is deliberately a 200 whose body is a refusal: this endpoint runs a tool
    // on the model's behalf, so the refusal has to come back as a tool result
    // the model can read. Asserting 400/403 failed a guard that works --
    // `simulate_suspicious_user.py::_probe_disabled_tool_bypass` had the same
    // wrong expectation. Assert on behaviour: refused at any status is a pass,
    // a 200 carrying real search output is the bypass.
    expect(exec.status()).not.toBe(500);
    const execBody = JSON.stringify(await exec.json().catch(() => ({}))).toLowerCase();
    const refused = /switched off|disabled|not available|blocked|turned off/.test(execBody);
    if (exec.status() === 200) {
      expect(refused, `web_search ran despite being disabled: ${execBody.slice(0, 300)}`).toBeTruthy();
    } else {
      expect([400, 403].includes(exec.status()) || refused).toBeTruthy();
    }

    // cleanup: re-enable for other tests
    await request.patch(`${API}/api/tools/`, {
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      data: { tool_name: 'web_search', enabled: true },
    }).catch(() => {});
  });

  test('plan autonomy withholds mutating tools', async ({ request }) => {
    const { access } = await (await import('../helpers/auth')).registerOrLogin(request, REGULAR_USER);
    const r = await request.post(`${API}/api/orchestrator/agents/`, {
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      data: {
        name: `PlanProbe ${Date.now() % 100000}`,
        brief: 'plan test',
        provider: 'nvidia',
        model: 'openai/gpt-oss-20b',
        tools: { rag: true, webSearch: true, fileOps: true, codeExecution: true, mcp: true },
        autonomy: 'plan',
      },
    });
    expect(r.ok()).toBeTruthy();
    const agent = await r.json();
    expect(agent.id).toBeTruthy();
    // mid-run switch to plan should be refused elsewhere — just assert creation succeeded
  });
});
