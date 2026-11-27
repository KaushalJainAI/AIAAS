/**
 * The spend guard for live specs (they cost real money).
 *
 * How it works:
 *   1. globalSetup (global-setup.ts) reads the OpenRouter key's usage once per
 *      run and writes it to test-results/live-budget.json. Every worker reads
 *      that same file, so the budget is shared across the whole run.
 *   2. Before each live test, `budgetBlock()` reads usage again. If the run has
 *      spent E2E_BUDGET_USD (default $2) or more, the test is skipped with a
 *      message saying so. If usage cannot be read, the test is skipped too:
 *      an unknown spend must not be treated as a free one.
 *   3. Each live test appends its result and its own spend to
 *      test-results/live-results.json, and globalTeardown prints the total.
 *
 * The key is read from E2E_OPENROUTER_KEY and sent only in the Authorization
 * header. It is never logged, written to a file or put in an error message.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** better-n8n-frontend/test-results, the folder Playwright already writes to. */
export const RESULTS_DIR = resolve(here, '../../../../test-results');
export const BUDGET_FILE = resolve(RESULTS_DIR, 'live-budget.json');
export const RESULTS_FILE = resolve(RESULTS_DIR, 'live-results.json');

/** Live specs run only when this is set. Free specs never look at it. */
export const LIVE_ENABLED = process.env.E2E_LIVE_MODEL === '1';

/** Dollars the whole run may spend. A bad value falls back to the default. */
export const BUDGET_USD = (() => {
  const raw = Number(process.env.E2E_BUDGET_USD ?? 2);
  return Number.isFinite(raw) && raw > 0 ? raw : 2;
})();

/** The OpenRouter model every live test uses. Pinned by CLAUDE.md's table. */
export const LIVE_MODEL = {
  provider: 'openrouter',
  model: 'anthropic/claude-haiku-5.5',
  effort: 'medium',
} as const;

export interface BudgetFile {
  /** OpenRouter usage (US dollars) when the run started. */
  startUsage: number;
  startedAt: string;
  budgetUsd: number;
}

export interface LiveResult {
  name: string;
  passed: boolean;
  seconds: number;
  /** Dollars this test spent, or null when usage could not be read. */
  spendUsd: number | null;
}

/**
 * Total usage in US dollars for the key in E2E_OPENROUTER_KEY.
 * Throws with a message that never contains the key.
 */
export async function readOpenRouterUsage(): Promise<number> {
  const key = process.env.E2E_OPENROUTER_KEY;
  if (!key) throw new Error('E2E_OPENROUTER_KEY is not set');
  const response = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`OpenRouter key check returned HTTP ${response.status}`);
  const body = (await response.json()) as { data?: { usage?: unknown } };
  const usage = body.data?.usage;
  if (typeof usage !== 'number' || !Number.isFinite(usage)) {
    throw new Error('OpenRouter key check had no usage figure');
  }
  return usage;
}

export function readBudgetFile(): BudgetFile | null {
  if (!existsSync(BUDGET_FILE)) return null;
  try {
    return JSON.parse(readFileSync(BUDGET_FILE, 'utf8')) as BudgetFile;
  } catch {
    return null;
  }
}

/** Record the starting usage and start an empty results file. Called once per run. */
export async function initLiveRun(): Promise<void> {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const startUsage = await readOpenRouterUsage();
  const file: BudgetFile = {
    startUsage,
    startedAt: new Date().toISOString(),
    budgetUsd: BUDGET_USD,
  };
  writeFileSync(BUDGET_FILE, JSON.stringify(file, null, 2));
  writeFileSync(RESULTS_FILE, '[]\n');
}

/**
 * Why a live test must not run now, or null when it may run. Called from a
 * beforeEach, where its result becomes `test.skip(reason)`.
 */
export async function budgetBlock(): Promise<string | null> {
  const file = readBudgetFile();
  if (!file) {
    return 'no budget file: the live run did not start through globalSetup';
  }
  let usage: number;
  try {
    usage = await readOpenRouterUsage();
  } catch (error) {
    // Unknown spend is treated as unavailable spend.
    return `could not read OpenRouter usage, so live tests are skipped (${(error as Error).message})`;
  }
  const spent = usage - file.startUsage;
  if (spent >= file.budgetUsd) {
    return `E2E budget spent: $${spent.toFixed(4)} of $${file.budgetUsd.toFixed(2)}. Raise E2E_BUDGET_USD to run more.`;
  }
  return null;
}

/** Spend since the run started, or null when usage cannot be read right now. */
export async function spentThisRun(): Promise<number | null> {
  const file = readBudgetFile();
  if (!file) return null;
  try {
    return (await readOpenRouterUsage()) - file.startUsage;
  } catch {
    return null;
  }
}

/** Add one line to test-results/live-results.json. Creates the file if needed. */
export function appendLiveResult(result: LiveResult): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  let rows: LiveResult[] = [];
  if (existsSync(RESULTS_FILE)) {
    try {
      rows = JSON.parse(readFileSync(RESULTS_FILE, 'utf8')) as LiveResult[];
    } catch {
      rows = [];
    }
  }
  rows.push(result);
  writeFileSync(RESULTS_FILE, JSON.stringify(rows, null, 2) + '\n');
}

/** Write a JSON file under test-results/ (used by the long-horizon report). */
export function writeResultsJson(name: string, value: unknown): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const path = resolve(RESULTS_DIR, name);
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
  return path;
}
