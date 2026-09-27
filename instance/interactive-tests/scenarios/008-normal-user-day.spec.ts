/**
 * 008 — A normal user's day (recorded walkthrough)
 *
 * What a real person does on a first working session, in one unbroken take:
 * sign in through the actual form, ask the assistant something, look at their
 * documents, open an agent, run it, and read the record of what it did.
 *
 * Two things make this different from 001, which covers the same ground:
 *
 * - **It signs in by typing.** Every other scenario injects a JWT into
 *   localStorage, which is right for a test that wants to get to the point --
 *   but it means the login screen, the redirect, and the authenticated shell
 *   are never exercised together, and none of it can be filmed. Here the
 *   credentials are typed into the real form.
 * - **It is paced for a viewer.** `beat()` and per-character typing delays make
 *   the recording watchable. Under `E2E_RECORD=1` the config also turns video
 *   on for every scenario and sizes the viewport; without it this still runs as
 *   an ordinary (if slightly slow) test.
 *
 * It still asserts. A walkthrough that cannot fail is a screensaver: the run
 * stage checks the agent produced a non-empty answer and spent tokens, because
 * "completed" alone was exactly what hid a provider error behind a green run.
 *
 * Record:
 *   E2E_RECORD=1 npx playwright test scenarios/008-normal-user-day.spec.ts
 *   # video lands under test-results/008-... /video.webm
 *
 * Prereq: `python instance/scripts/seed_instance.py`, backend :8000, frontend :5173.
 */
import { test, expect, type Page } from '@playwright/test';
import { REGULAR_USER, API_BASE } from '../helpers/auth';
import { env, envInt, isRecording } from '../helpers/testenv';
import { waitForChatIdle } from '../helpers/assertions';

const TYPING = envInt('E2E_TYPING_DELAY_MS', 45);
const BEAT = envInt('E2E_BEAT_MS', 900);

/**
 * A pause between steps, so a viewer can see what changed.
 *
 * Only when recording: an ordinary CI run should not spend twenty seconds
 * looking at finished pages.
 */
async function beat(page: Page, multiplier = 1): Promise<void> {
  if (isRecording()) await page.waitForTimeout(BEAT * multiplier);
}

/** Type into a field the way a person does, not with `fill`. */
async function humanType(page: Page, selector: ReturnType<Page['locator']>, text: string): Promise<void> {
  await selector.click();
  await selector.fill('');
  await page.keyboard.type(text, { delay: TYPING });
}

test.describe('008 — a normal user works through the app', () => {
  test('sign in → ask → documents → agent → run → read the record', async ({ page, request }) => {
    // Real provider calls in the middle of this; the default 45s is not enough.
    test.setTimeout(isRecording() ? 300_000 : 180_000);

    // ── 1. Sign in, by typing, on the real login screen ──────────────────────
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /log ?in|sign ?in/i })).toBeVisible();
    await beat(page);

    await humanType(page, page.getByLabel(/email/i), REGULAR_USER.email);
    await humanType(page, page.getByLabel(/password/i), REGULAR_USER.password);
    await beat(page);

    await page.getByRole('button', { name: /log ?in|sign ?in/i }).click();

    // Landing anywhere that is not /login is the assertion: the form worked,
    // the token was stored, and the shell rendered for a real session.
    await expect(page, 'login did not leave the login screen').not.toHaveURL(/\/login/, {
      timeout: 30_000,
    });
    await expect(page.locator('nav a, aside a').first()).toBeVisible({ timeout: 15_000 });
    await beat(page, 1.5);

    // ── 2. Ask the assistant something ───────────────────────────────────────
    // Pin the chat model the way the app itself stores it. The picker reads
    // `standalone_chat_llm_provider` / `standalone_chat_llm_model` from
    // localStorage and falls back to a hardcoded default -- it does not read
    // `UserProfile.llm_model` -- so seeding the profile alone left the chat on
    // the platform default, which is the model measured at ~50% "Service
    // temporarily overloaded". A walkthrough must not gamble on the provider.
    await page.evaluate(
      ([provider, model]) => {
        localStorage.setItem('standalone_chat_llm_provider', provider);
        localStorage.setItem('standalone_chat_llm_model', model);
      },
      [env('E2E_DEMO_PROVIDER', 'nvidia'), env('E2E_DEMO_MODEL', 'openai/gpt-oss-20b')],
    );

    await page.goto('/ai-chat');
    // Address the composer by its own name attribute. `getByRole('button',
    // { name: /send/i })` picked up an unrelated control and clicked it, so the
    // message was typed and never sent -- and the scenario then blamed the
    // transcript. Enter is what a person presses anyway: the textarea's own
    // keydown handler calls `handleSend`.
    const composer = page.locator('textarea[name="chat-input"]');
    await expect(composer).toBeVisible({ timeout: 15_000 });
    await beat(page);

    await humanType(page, composer, 'In one sentence, what can you help me with?');
    await beat(page);
    await page.keyboard.press('Enter');

    await waitForChatIdle(page, 90_000);

    // The user's own message must be in the transcript, and the assistant must
    // have said something back. Asserting on the model's *wording* would fail
    // for the wrong reason; asserting that a non-empty reply rendered is the
    // part that is actually a contract -- and it is the browser-level twin of
    // the empty-answer bug the run stage below guards against.
    await expect(
      page.getByText(/what can you help me with/i).first(),
      'the message the user typed never appeared in the transcript',
    ).toBeVisible({ timeout: 15_000 });

    const reply = page.locator('[data-role="assistant"], .prose').last();
    if (await reply.count()) {
      const text = ((await reply.innerText().catch(() => '')) ?? '').trim();
      expect(text.length, 'the assistant bubble rendered empty').toBeGreaterThan(0);
    }
    await beat(page, 2);

    // ── 3. Look at their documents ───────────────────────────────────────────
    await page.goto('/documents');
    await expect(page.locator('main').first()).toBeVisible({ timeout: 15_000 });
    // The seeder puts these here; if they are missing the demo world is not
    // loaded and everything after this would be misleading.
    await expect(
      page.getByText(/invoice-ACME|getting-started|Invoices|Reports/i).first(),
      'seeded documents are not visible — run instance/scripts/seed_instance.py',
    ).toBeVisible({ timeout: 15_000 });
    await beat(page, 2);

    // ── 4. Open the agents they have ─────────────────────────────────────────
    await page.goto('/agents');
    await expect(
      page.getByText(/Finance helper|Researcher|Docs librarian/i).first(),
      'seeded agents are not listed',
    ).toBeVisible({ timeout: 15_000 });
    await beat(page, 2);

    // ── 5. Run one, and wait for it to actually answer ───────────────────────
    // Driven through the API rather than the builder UI: the point of this beat
    // is the *run*, and clicking through the builder to reach one would spend
    // the recording on form-filling. The assertions below are the strict part.
    const access = await page.evaluate(() => localStorage.getItem('access_token'));
    expect(access, 'no access token in localStorage after signing in').toBeTruthy();
    const auth = { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' };

    const listed = await request.get(`${API_BASE}/api/orchestrator/agents/`, { headers: auth });
    expect(listed.ok(), `listing agents failed: ${listed.status()}`).toBeTruthy();
    const body = await listed.json();
    const agents = Array.isArray(body) ? body : body.agents ?? body.results ?? [];
    const agent = agents.find((a: any) => /Finance helper/i.test(a.name ?? '')) ?? agents[0];
    expect(agent?.id, 'no agent available to run').toBeTruthy();

    const started = await request.post(
      `${API_BASE}/api/orchestrator/agents/${agent.id}/execute/`,
      { headers: auth, data: { goal: 'Say exactly: walkthrough-ok' } },
    );

    if (started.status() === 402) {
      // A named refusal (no credential, spend cap) is correct behaviour, and a
      // demo machine may legitimately be in that state. It must still be named.
      const refusal = await started.json();
      expect(refusal.error ?? refusal.detail, 'refusal carried no reason').toBeTruthy();
    } else {
      expect(started.status(), `execute returned ${started.status()}`).toBe(202);
      const executionId = (await started.json()).execution_id;
      expect(executionId, 'execute returned no execution_id').toBeTruthy();

      // Accepting a run is not running it. Follow it to a terminal status.
      const deadline = Date.now() + envInt('E2E_RUN_TIMEOUT_S', 60) * 1000;
      let final: any = null;
      let status = '';
      while (Date.now() < deadline) {
        const r = await request.get(`${API_BASE}/api/logs/executions/${executionId}/`, { headers: auth });
        if (r.ok()) {
          final = await r.json();
          status = String(final.status ?? '').toLowerCase();
          if (['completed', 'failed', 'timeout', 'cancelled', 'paused'].includes(status)) break;
        }
        await page.waitForTimeout(1_500);
      }

      expect(['completed', 'paused'], `run ended ${status}: ${final?.error_message ?? ''}`)
        .toContain(status);

      if (status === 'completed') {
        // The assertion this whole suite exists for. A run that returned
        // nothing is a failed run whatever the status column says: a provider
        // answering HTTP 200 with a 503 error frame inside the SSE body used to
        // land here as `completed`, `answer: ""`, `tokens_used: 0`.
        const answer = String(final?.output_data?.answer ?? '').trim();
        expect(answer, 'run completed with an empty answer (swallowed provider error?)').not.toBe('');
        expect(answer, `run surfaced a provider problem: ${answer}`).not.toMatch(/^⚠/);
        expect(final?.tokens_used ?? 0, 'run completed without spending any tokens').toBeGreaterThan(0);
      }
    }

    // ── 6. Read the record of what happened ──────────────────────────────────
    await page.goto('/runs');
    await expect(page.locator('main').first()).toBeVisible({ timeout: 15_000 });
    await expect(page, 'reading runs bounced the user to login').not.toHaveURL(/\/login/);
    await beat(page, 2);

    await page.goto('/overview');
    await expect(page.locator('main').first()).toBeVisible({ timeout: 15_000 });
    await beat(page, 2);
  });
});
