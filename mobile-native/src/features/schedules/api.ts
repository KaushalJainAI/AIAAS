/**
 * Schedules API: list, create, edit, delete, run now, rotate a webhook secret,
 * preview a cron expression, and scheduler health.
 *
 * Mirrors better-n8n-frontend/src/api/triggers.ts, one function per endpoint.
 * Paths are relative to /api; `api()` prepends it.
 */

import { api } from '../../api/client';
import type {
  PreviewInput,
  RotateSecretResult,
  RunNowResult,
  SchedulePreview,
  SchedulerHealth,
  Trigger,
  TriggerInput,
} from './types';

/** The list answers a bare array, or `{results, truncated}` when it hits its cap. Accept both. */
function listOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const results = (data as { results?: unknown }).results;
    if (Array.isArray(results)) return results as T[];
  }
  return [];
}

/** Every trigger the caller owns, or one agent's when `agentId` is given. */
export async function listTriggers(agentId?: number): Promise<Trigger[]> {
  const data = await api<unknown>('/orchestrator/triggers/', {
    query: agentId ? { agent: agentId } : undefined,
  });
  return listOf<Trigger>(data);
}

/**
 * What a cron expression means, before it is saved. Answers 200 with
 * `valid: false` for a bad expression, so a field still being typed does not
 * raise an error per keystroke. This is the server's reading, the only one
 * the sweep acts on.
 */
export function previewSchedule(input: PreviewInput): Promise<SchedulePreview> {
  return api<SchedulePreview>('/orchestrator/triggers/preview/', { method: 'POST', body: input });
}

export function createTrigger(input: TriggerInput): Promise<Trigger> {
  return api<Trigger>('/orchestrator/triggers/', { method: 'POST', body: input });
}

/** PATCH: an unmentioned field keeps its value. */
export function updateTrigger(id: number, patch: Partial<TriggerInput>): Promise<Trigger> {
  return api<Trigger>(`/orchestrator/triggers/${id}/`, { method: 'PATCH', body: patch });
}

export function deleteTrigger(id: number): Promise<null> {
  return api<null>(`/orchestrator/triggers/${id}/`, { method: 'DELETE' });
}

/**
 * Fire a schedule now, through the sweep's own gates. Answers 202 with the
 * execution id once the run has started. A manual firing does not move
 * `next_due_at`.
 */
export function runTriggerNow(id: number): Promise<RunNowResult> {
  return api<RunNowResult>(`/orchestrator/triggers/${id}/run/`, { method: 'POST', body: {} });
}

/**
 * Issue a new secret for a webhook, revoking the URL handed out. Rotation is
 * instant: a leaked credential that keeps working is leaked.
 */
export function rotateTriggerSecret(id: number): Promise<RotateSecretResult> {
  return api<RotateSecretResult>(`/orchestrator/triggers/${id}/rotate/`, { method: 'POST', body: {} });
}

/** Is the in-process scheduler checking in? A stopped scheduler must say so. */
export function getSchedulerHealth(): Promise<SchedulerHealth> {
  return api<SchedulerHealth>('/orchestrator/triggers/health/');
}

/**
 * PATCH an agent. Used by the two fixes a schedule's status can ask for: letting
 * the agent run unattended (`allowUnattended`) and resuming it (`status`).
 * Same field names the builder sends, in camelCase.
 */
export function patchAgent(agentId: number, patch: Record<string, unknown>): Promise<unknown> {
  return api<unknown>(`/orchestrator/agents/${agentId}/`, { method: 'PATCH', body: patch });
}
