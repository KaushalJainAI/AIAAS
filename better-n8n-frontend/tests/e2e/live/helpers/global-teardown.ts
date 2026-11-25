/**
 * Runs once after the whole test run. Prints what the live run spent.
 *
 * Silent for free runs. For live runs it prints the total spend and how many
 * live tests passed, so the cost is visible at the end of the terminal output
 * and not only in the result files.
 */
import { BUDGET_USD, LIVE_ENABLED, readBudgetFile, readOpenRouterUsage, RESULTS_FILE } from './budget';
import { readFileSync, existsSync } from 'node:fs';

export default async function globalTeardown(): Promise<void> {
  if (!LIVE_ENABLED) return;
  const file = readBudgetFile();
  if (!file) return;
  try {
    const spent = (await readOpenRouterUsage()) - file.startUsage;
    console.log(`[live] total spent this run: $${spent.toFixed(4)} of $${BUDGET_USD.toFixed(2)} budget`);
  } catch {
    console.log('[live] could not read the final spend (see test-results/live-results.json per test)');
  }
  if (existsSync(RESULTS_FILE)) {
    const rows = JSON.parse(readFileSync(RESULTS_FILE, 'utf8')) as { passed: boolean }[];
    const passed = rows.filter((r) => r.passed).length;
    console.log(`[live] ${passed} of ${rows.length} live tests passed`);
  }
}
