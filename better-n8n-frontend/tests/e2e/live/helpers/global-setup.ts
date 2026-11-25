/**
 * Runs once before the whole test run. Only does anything for live runs.
 *
 * It records the OpenRouter usage at the start, so every live test can measure
 * its own spend and the budget guard can stop the run in time. Without
 * E2E_LIVE_MODEL=1 it returns at once and the free specs are unaffected.
 */
import { initLiveRun, LIVE_ENABLED } from './budget';

export default async function globalSetup(): Promise<void> {
  if (!LIVE_ENABLED) return;
  if (!process.env.E2E_OPENROUTER_KEY) {
    throw new Error('E2E_LIVE_MODEL=1 needs E2E_OPENROUTER_KEY to read the spend budget');
  }
  await initLiveRun();
}
