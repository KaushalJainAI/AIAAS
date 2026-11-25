/**
 * LIVE: a long-horizon agent run on the real model (costs money).
 *
 * Skipped unless E2E_LIVE_MODEL=1 and E2E_OPENROUTER_KEY are set, and skipped
 * again if the run's budget is spent.
 *
 * The platform is built for runs with many steps: a plan, many tool calls, the
 * results read back, and a transcript that the context lifecycle has to keep
 * inside the window (Backend/docs/CONTEXT_LIFECYCLE.md). This test gives one
 * such task and measures the run instead of only checking it finished.
 *
 * The task has a checkable answer: 7+14+21+28+35 = 105. So the assertions
 * prove the work was done, not just that the run ended.
 *
 * Measurements are written to test-results/long-horizon.json even when an
 * assertion fails (the write is in a finally), and console.logged.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';

import { LIVE_ENABLED, budgetBlock, LIVE_MODEL, spentThisRun, writeResultsJson } from './helpers/budget';
import {
  API,
  createAgent,
  findFile,
  liveAccount,
  liveTest,
  readFileText,
  startRun,
  waitForRun,
} from './helpers/live';

test.skip(!LIVE_ENABLED, 'live spec: set E2E_LIVE_MODEL=1 and E2E_OPENROUTER_KEY to run it');
test.describe.configure({ mode: 'serial' });

test.beforeEach(async () => {
  const reason = await budgetBlock();
  test.skip(reason !== null, reason ?? '');
});

const GOAL =
  'Create five files named step1.txt to step5.txt. Each file must contain the number of its step multiplied by 7. ' +
  'Then read all five files back, add the numbers, and write the total to total.txt. ' +
  'Finally write report.md listing each file and its value. Work one step at a time.';

/** Iteration limit: well above the ~15 calls this task needs, well below the default cap of 36. */
const MAX_ITERATIONS = 30;
const RUN_TIMEOUT_MS = 6 * 60_000;

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

interface LongHorizonReport {
  test: 'long-horizon';
  model: string;
  effort: string;
  maxIterations: number;
  goal: string;
  runStatus: string | null;
  wallSeconds: number | null;
  turns: number | null;
  toolSteps: number | null;
  tokensUsed: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedReadTokens: number | null;
  costUsd: string | null;
  costSource: string | null;
  /** Whether the run curated (compacted or folded) its own transcript. */
  curated: boolean;
  curation: unknown;
  spendUsd: number | null;
  checks: Check[];
  error: string | null;
}

test.describe('@live agent run — live long horizon', () => {
  test('five steps, a sum and a report, finished and checked', async () => {
    test.setTimeout(RUN_TIMEOUT_MS + 90_000);
    await liveTest('long-horizon', async () => {
      const spendBefore = await spentThisRun();
      const report: LongHorizonReport = {
        test: 'long-horizon',
        model: LIVE_MODEL.model,
        effort: LIVE_MODEL.effort,
        maxIterations: MAX_ITERATIONS,
        goal: GOAL,
        runStatus: null,
        wallSeconds: null,
        turns: null,
        toolSteps: null,
        tokensUsed: null,
        inputTokens: null,
        outputTokens: null,
        cachedReadTokens: null,
        costUsd: null,
        costSource: null,
        curated: false,
        curation: null,
        spendUsd: null,
        checks: [],
        error: null,
      };
      const check = (name: string, pass: boolean, detail: string) =>
        report.checks.push({ name, pass, detail });

      let api: APIRequestContext | null = null;
      try {
        ({ api } = await liveAccount());
        const agentId = await createAgent(api, {
          name: 'e2e long horizon',
          description: 'E2E: a multi-step file task with a checkable answer.',
          tools: { fileOps: true },
          fileAccess: 'read_all_write_own',
          autonomy: 'auto',
          maxIterations: MAX_ITERATIONS,
        });

        const started = Date.now();
        const executionId = await startRun(api, agentId, GOAL);
        const run = await waitForRun(api, executionId, RUN_TIMEOUT_MS);
        report.wallSeconds = Math.round((Date.now() - started) / 100) / 10;
        report.runStatus = run.status;

        const detail = (await (await api.get(`${API}/api/logs/executions/${executionId}/`)).json()) as {
          turn_total?: number;
          step_total?: number;
          tokens_used?: number;
          input_tokens?: number;
          output_tokens?: number;
          cached_read_tokens?: number;
          cost_usd?: string;
          cost_source?: string;
          output_data?: { context_curation?: unknown } | null;
        };
        report.turns = detail.turn_total ?? null;
        report.toolSteps = detail.step_total ?? null;
        report.tokensUsed = detail.tokens_used ?? null;
        report.inputTokens = detail.input_tokens ?? null;
        report.outputTokens = detail.output_tokens ?? null;
        report.cachedReadTokens = detail.cached_read_tokens ?? null;
        report.costUsd = detail.cost_usd ?? null;
        report.costSource = detail.cost_source ?? null;
        // Curation only appears in output_data when it actually ran.
        report.curation = detail.output_data?.context_curation ?? null;
        report.curated = report.curation !== null;

        check(
          'run completed',
          run.status === 'completed',
          `status ${run.status}${run.error_message ? `: ${run.error_message}` : ''}`,
        );

        const expected = [1, 2, 3, 4, 5].map((n) => ({ name: `step${n}.txt`, value: String(n * 7) }));
        for (const { name, value } of expected) {
          try {
            const file = await findFile(api, name);
            if (!file) {
              check(`${name} exists with ${value}`, false, 'file not found');
              continue;
            }
            const text = (await readFileText(api, file.id)).trim();
            check(`${name} exists with ${value}`, text === value, `content "${text}"`);
          } catch (error) {
            check(`${name} exists with ${value}`, false, (error as Error).message);
          }
        }

        try {
          const total = await findFile(api, 'total.txt');
          if (!total) {
            check('total.txt contains 105', false, 'file not found');
          } else {
            const text = await readFileText(api, total.id);
            check('total.txt contains 105', text.includes('105'), `content "${text.trim()}"`);
          }
        } catch (error) {
          check('total.txt contains 105', false, (error as Error).message);
        }

        try {
          const reportMd = await findFile(api, 'report.md');
          check('report.md exists', reportMd !== null, reportMd ? 'found' : 'file not found');
        } catch (error) {
          check('report.md exists', false, (error as Error).message);
        }
      } catch (error) {
        report.error = (error as Error).message;
      } finally {
        const spendAfter = await spentThisRun();
        report.spendUsd =
          spendBefore !== null && spendAfter !== null
            ? Math.max(0, Number((spendAfter - spendBefore).toFixed(6)))
            : null;
        const path = writeResultsJson('long-horizon.json', report);
        console.log(`[long-horizon] ${JSON.stringify(report, null, 2)}`);
        console.log(`[long-horizon] written to ${path}`);
        if (api) await api.dispose();
      }

      // Asserts only after the report is on disk. A failure still fails the test.
      expect(report.error, 'the run should set up and finish without an error').toBeNull();
      for (const c of report.checks) {
        expect(c.pass, `${c.name}: ${c.detail}`).toBe(true);
      }
    });
  });
});
