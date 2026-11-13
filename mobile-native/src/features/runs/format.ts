/**
 * Labels and money for the runs screens.
 *
 * Words copied from better-n8n-frontend/src/components/activity and
 * src/lib/cost.ts, so a run reads the same on the phone as on the web.
 *
 * Money is rupees, as the web's Runs and Insights pages show it. The agents
 * screen still formats cost in dollars; that is a difference between the two
 * mobile areas, not something this file decides.
 */

import type { CostSource, FailureCategory, LiveItem, RunAutonomyLevel, RunCaller, RunStatus } from './types';

/** Must match `USD_TO_INR` in Backend/llm/pricing.py and better-n8n-frontend/src/lib/cost.ts. */
export const USD_TO_INR = 88;

export const CALLER_LABEL: Record<RunCaller, string> = {
  api: 'API',
  chat: 'Chat',
  orchestrator: 'Another agent',
  trigger: 'Schedule',
  eval: 'Evaluation',
  mission: 'Mission',
};

export const FAILURE_LABEL: Record<FailureCategory, string> = {
  provider: 'Model provider',
  step_budget: 'Ran out of steps',
  tool_error: 'Tool error',
  guardrail: 'Blocked by a guardrail',
  contract: 'Wrong answer shape',
  timeout: 'Timed out',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
  other: 'Other',
};

export const STATUS_FILTER_LABEL: Record<RunStatus, string> = {
  running: 'Running',
  paused: 'Waiting for you',
  pending: 'Queued',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const AUTONOMY_OPTIONS: { key: RunAutonomyLevel; label: string; hint: string }[] = [
  { key: 'review', label: 'Review', hint: 'Ask before every step' },
  { key: 'ask', label: 'Ask', hint: 'Ask before anything leaves the account' },
  { key: 'auto', label: 'Auto', hint: 'Only ask before permanent changes' },
  { key: 'full', label: 'Full', hint: 'Never ask' },
];

export const LIVE_KIND_LABEL: Record<string, string> = {
  agent_run: 'Run',
  code_task: 'Code task',
  eval_sweep: 'Eval sweep',
  eval_world: 'Eval world',
  chat_turn: 'Chat',
};

/** A run that can still change. */
export function isLiveRun(status: string | null | undefined): boolean {
  return status === 'running' || status === 'pending' || status === 'paused';
}

/** A run whose row may be deleted: finished, and not an evaluation run (its sweep owns it). */
export function isDeletableRun(run: { status: string; caller: string }): boolean {
  return !isLiveRun(run.status) && run.caller !== 'eval';
}

/** Server verbs for a live row, in the order the web shows them. Unknown verbs are dropped. */
export type LiveAction = 'stop' | 'steer' | 'mark_failed' | 'open';

const LIVE_ACTION_ORDER: LiveAction[] = ['stop', 'steer', 'mark_failed', 'open'];

export const LIVE_ACTION_LABEL: Record<LiveAction, string> = {
  stop: 'Stop',
  steer: 'Steer',
  mark_failed: 'Mark as failed',
  open: 'Open',
};

export function liveActions(item: LiveItem): LiveAction[] {
  const verbs = new Set(item.actions ?? []);
  return LIVE_ACTION_ORDER.filter((id) => verbs.has(id));
}

/**
 * A rupee figure from a USD string. `unpriced` is not a zero: the server has no
 * price on record, which is a different fact from a free run, so it shows a dash.
 */
export function formatCostInr(
  costUsd: string | number | null | undefined,
  source: CostSource | '' | null | undefined,
): string {
  if (!source || source === 'unpriced') return '—';
  const parsed = typeof costUsd === 'number' ? costUsd : parseFloat(costUsd ?? '');
  const inr = (Number.isFinite(parsed) ? parsed : 0) * USD_TO_INR;
  if (inr === 0) return '₹0';
  if (inr < 0.01) return `₹${inr.toFixed(3)}`;
  if (inr < 100) return `₹${inr.toFixed(2)}`;
  return `₹${Math.round(inr).toLocaleString('en-IN')}`;
}

/** The word a bare figure needs beside it: "charged", "estimated", or nothing. */
export function costQualifier(source: CostSource | '' | null | undefined): string {
  if (source === 'billed') return 'charged';
  if (source === 'estimated') return 'estimated';
  return '';
}

/** A rupee value as a number, for charts. Unpriced and missing values are zero. */
export function inrValue(costUsd: string | number | null | undefined): number {
  const parsed = typeof costUsd === 'number' ? costUsd : parseFloat(costUsd ?? '');
  return Number.isFinite(parsed) ? parsed * USD_TO_INR : 0;
}

/** 1234 -> "1.2k", 2_500_000 -> "2.5M". */
export function compactNumber(n: number | null | undefined): string {
  const value = n ?? 0;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

export function percent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.round(value)}%`;
}

/** The run-detail JSON an args/result cell shows: pretty, and never unbounded. */
export function prettyJson(value: unknown, limit = 4000): string {
  if (value == null) return '';
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? '';
  } catch {
    text = String(value);
  }
  if (text === '{}' || text === '[]' || text === 'null') return '';
  return text.length > limit ? `${text.slice(0, limit)}\n… (${text.length - limit} more characters)` : text;
}
