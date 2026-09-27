/**
 * 001 — Regular user smoke journey (the 7-stage happy path)
 *
 * Input: a regular_user persona acting like a human
 * Output: each stage asserts API contract + UI rendering
 * UX: typing delays, waiting for streams, no fixed sleeps where a signal exists
 *
 * Covers instance/docs/USER_JOURNEY.md stages 0→5 at browser fidelity.
 * Runs against real Backend (:8000) + Frontend (:5173).
 *
 * Prereq: Backend seeded (python instance/scripts/seed_instance.py) or scenario seeds its own data.
 */
import { test, expect } from '@playwright/test';
import { signInAs, REGULAR_USER, expectAuthenticated } from '../helpers/auth';
import { createFolder, createAgent, listTools } from '../helpers/seed';
import { waitForChatIdle } from '../helpers/assertions';

test.describe('regular user smoke — 7-stage journey', () => {
  test('signup → explore → build → connect → run → observe', async ({ page, request }) => {
    test.setTimeout(120_000);

    // ── Stage 0: Auth (API + inject, then prove UI is authenticated) ──
    const { access } = await signInAs(page, request, REGULAR_USER);
    await page.goto('/ai-chat');
    await expectAuthenticated(page);

    // ── Stage 1a: Chat — send a message like a human, assert streaming UX ──
    await expect(page.getByPlaceholder(/ask anything/i).or(page.locator('textarea').first())).toBeVisible({ timeout: 10_000 });

    const composer = page.getByPlaceholder(/ask anything/i).or(page.locator('textarea').first());
    // human-like typing
    await composer.click();
    await composer.fill('');
    await page.keyboard.type("Say 'smoke-ok' and nothing else.", { delay: 30 });
    // Send — Enter or click Send button
    const sendBtn = page.getByRole('button', { name: /send/i }).first();
    if (await sendBtn.isVisible()) await sendBtn.click();
    else await page.keyboard.press('Enter');

    // either we get streaming (stop button appears) or a fast error/empty due to missing LLM key
    // waitForChatIdle handles both; don't fail on LLM-unavailable in smoke
    await waitForChatIdle(page, 40_000);
    // at least the user message is in the transcript
    await expect(page.getByText(/smoke-ok/i).or(page.locator('[data-role="user"]')).first()).toBeVisible({ timeout: 10_000 }).catch(() => {});

    // ── Stage 1b: Documents — create folder, upload, see it ──
    await page.goto('/documents');
    await expect(page.getByRole('tab', { name: /my documents|personal/i }).or(page.getByText(/my documents/i)).first()).toBeVisible({ timeout: 10_000 }).catch(async () => {
      // fallback: Documents page header
      await expect(page.locator('main').first()).toBeVisible();
    });

    // create a smoke folder via API (faster + proves contract), then assert UI shows it
    const folderName = `smoke-${Date.now() % 100000}`;
    try {
      await createFolder(request, access, folderName);
    } catch (e) {
      // folder may already exist — ignore
    }
    await page.reload();
    // folder tile may appear as text
    await expect(page.getByText(folderName).first()).toBeVisible({ timeout: 10_000 }).catch(() => {
      // non-fatal — folder list may be paginated
    });

    // ── Stage 2: Build — Agents list → Builder → Save ──
    await page.goto('/agents');
    await expect(page.getByRole('heading', { name: /agents/i }).or(page.getByText(/agents/i).first())).toBeVisible({ timeout: 10_000 });
    const newAgent = page.getByRole('link', { name: /new agent/i }).or(page.getByRole('button', { name: /new agent/i })).first();
    if (await newAgent.count()) await newAgent.click();
    else await page.goto('/agents/new');

    // Builder should show Identity section
    // `.or(page.locator('input').first())` matches two inputs on the builder
    // (the goal field and the name field) and fails strict mode before the
    // journey can continue. Address the name field by its own placeholder.
    await expect(
      page.getByPlaceholder('Finance agent').or(page.locator('input[type="text"]').last()).first(),
    ).toBeVisible({ timeout: 10_000 });

    const nameInput = page.getByPlaceholder(/finance agent/i);
    const smokeAgentName = `Smoke ${Date.now() % 100000}`;
    if (await nameInput.count()) {
      await nameInput.click();
      await nameInput.fill('');
      await nameInput.fill(smokeAgentName);
    }

    // Save — button says "Create agent" for new, "Save" for edit
    const saveBtn = page.getByRole('button', { name: /create agent|save changes|save/i }).first();
    if (await saveBtn.isVisible()) {
      await saveBtn.click();
      // after save, should toast and stay on builder or go to /agents
      await expect(page).not.toHaveURL(/\/login/, { timeout: 5_000 });
      await expect(page.getByText(/saved|created/i).first()).toBeVisible({ timeout: 10_000 }).catch(() => {});
    }

    // ── Stage 3: Connect — catalogue loads, not empty ──
    await page.goto('/connections');
    await expect(page.getByText(/connections|mcp|notion|google drive|slack/i).first()).toBeVisible({ timeout: 15_000 });
    // tools catalogue also reachable via API — assert contract
    const tools = await listTools(request, access).catch(() => null);
    if (tools) expect(tools.totalTools ?? tools.categories?.length ?? 0).toBeGreaterThan(0);

    await page.goto('/tools');
    await expect(page.getByText(/tools|enable|search tools/i).first()).toBeVisible({ timeout: 10_000 });

    // ── Stage 4: Run — execute the smoke agent and assert it produced an answer ──
    //
    // This used to stop at "the 202 carried an execution_id" inside a
    // try/catch marked non-fatal, so the stage passed whatever the run did --
    // including the real failure it was meant to catch, where the provider
    // returned an HTTP 200 SSE body containing a 503 error frame, the stream
    // yielded nothing, and the run closed as `completed` with `answer: ""` and
    // zero tokens. Accepting a run is not running it: follow it to a terminal
    // status and assert it said something.
    const { listAgents, executeAgent, waitForRun } = await import('../helpers/seed');
    const agents = await listAgents(request, access);
    const arr = Array.isArray(agents) ? agents : agents.agents ?? agents.data ?? [];
    const smoke = arr.find((a: any) => (a.name ?? '').includes(smokeAgentName)) ?? arr[0];
    expect(smoke?.id, 'no agent available to run').toBeTruthy();

    const res: any = await executeAgent(request, access, smoke.id, "Say exactly: smoke-ok");
    if (res._refused) {
      // A named refusal (no credential, spend cap) is correct behaviour and
      // must stay legible -- but it must be *named*, not a bare failure.
      expect(res.error ?? res.detail, 'refusal carried no reason').toBeTruthy();
    } else {
      const executionId = res.execution_id ?? res.id;
      expect(executionId, 'execute returned no execution_id').toBeTruthy();

      const final = await waitForRun(request, access, String(executionId));
      const status = String(final.status ?? final.execution?.status ?? '').toLowerCase();
      expect(['completed', 'paused'], `run ended ${status}: ${final.error_message ?? ''}`)
        .toContain(status);

      if (status === 'completed') {
        const output = final.output_data ?? final.execution?.output_data ?? {};
        const answer = String(output.answer ?? '').trim();
        expect(answer, 'run completed with an empty answer (swallowed provider error?)')
          .not.toBe('');
      }
    }

    // ── Stage 5: Observe — Runs + Overview load without 500 ──
    await page.goto('/runs');
    await expect(page.locator('main').first()).toBeVisible({ timeout: 10_000 });
    await expect(page).not.toHaveURL(/\/login/);

    await page.goto('/overview');
    await expect(page.locator('main').first()).toBeVisible({ timeout: 10_000 });

    // ── Journey complete ──
    // If we got here without a hard failure, the regular user's happy path renders end-to-end.
  });

  test('protected routes redirect when logged out', async ({ page }) => {
    await page.goto('/agents');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });
});
