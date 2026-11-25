/**
 * LIVE: an agent writes a file, and the run's changes are undone (costs money).
 *
 * Skipped unless E2E_LIVE_MODEL=1 and E2E_OPENROUTER_KEY are set, and skipped
 * again if the run's budget is spent.
 *
 * The agent gets only the file grant and a small step limit, so the run is
 * short and cheap. Autonomy is `auto`: the agent is not stopped to ask before
 * its one write, which would make this test wait on a person. The run is then
 * opened on its page, the Changes panel is used to undo it, and the file must
 * be gone from the account's files afterwards.
 */
import { expect, test } from '@playwright/test';

import { LIVE_ENABLED, budgetBlock } from './helpers/budget';
import {
  createAgent,
  findFile,
  liveAccount,
  liveTest,
  readFileText,
  signIn,
  startRun,
  waitForRun,
} from './helpers/live';

test.skip(!LIVE_ENABLED, 'live spec: set E2E_LIVE_MODEL=1 and E2E_OPENROUTER_KEY to run it');
test.describe.configure({ mode: 'serial' });

test.beforeEach(async () => {
  const reason = await budgetBlock();
  test.skip(reason !== null, reason ?? '');
});

const FILE = 'e2e-undo.txt';
const GOAL =
  'Create a file named e2e-undo.txt containing the word hello. Do nothing else.';

test.describe('@live agent run — live undo', () => {
  test('a run writes a file and the Changes panel puts it back', async ({ page }) => {
    // A run is a few model calls plus one write. 120 s: a little over the
    // 90 s the chat specs get, because an agent run also starts and polls.
    test.setTimeout(120_000);
    await liveTest('undo-run', async () => {
      const { account, api } = await liveAccount();
      try {
        const agentId = await createAgent(api, {
          name: 'e2e undo writer',
          description: 'E2E: writes one file, then stops.',
          tools: { fileOps: true },
          fileAccess: 'read_all_write_own',
          autonomy: 'auto',
          maxIterations: 8,
        });
        const executionId = await startRun(api, agentId, GOAL);
        const run = await waitForRun(api, executionId, 90_000);
        expect(run.status, `run ended as ${run.status}: ${run.error_message ?? ''}`).toBe('completed');

        // The write happened, and it is the text the goal asked for.
        const written = await findFile(api, FILE);
        expect(written, `${FILE} should exist after the run`).not.toBeNull();
        expect((await readFileText(api, written!.id)).trim()).toContain('hello');

        // Open the run's own page and use its Changes panel.
        await signIn(page, account);
        await page.goto(`/runs?run=${executionId}`);
        const changes = page.getByRole('region', { name: 'Changes' });
        await expect(changes).toBeVisible({ timeout: 30_000 });
        await changes.getByRole('button', { name: /Undo changes/ }).click();

        const sheet = page.getByRole('heading', { name: 'Undo what this run changed' });
        await expect(sheet).toBeVisible({ timeout: 15_000 });
        await page.getByRole('button', { name: /^Undo \d+ changes?$/ }).click();

        // The file is gone once the revert lands. Polled, because the revert
        // is a second request after the click.
        const deadline = Date.now() + 20_000;
        let stillThere = true;
        while (Date.now() < deadline && stillThere) {
          stillThere = (await findFile(api, FILE)) !== null;
          if (stillThere) await page.waitForTimeout(1_000);
        }
        expect(stillThere, `${FILE} should be gone after the undo`).toBe(false);
      } finally {
        await api.dispose();
      }
    });
  });
});
