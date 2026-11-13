/**
 * Runs API: the Activity screen's calls, run detail, feedback, insights, live
 * activity, spend, and the controls a run can be given while it works.
 *
 * Mirrors, endpoint for endpoint:
 *  - better-n8n-frontend/src/api/logs.ts       executions, detail, delete,
 *                                              bulk-delete, mark-failed,
 *                                              feedback, insights overview /
 *                                              costs / quality
 *  - better-n8n-frontend/src/api/activity.ts   activity/live, activity/recent-files
 *  - better-n8n-frontend/src/api/spend.ts      logs/spend/summary
 *  - better-n8n-frontend/src/api/agents.ts     cancelRun, steerRun, steer (agent),
 *                                              setRunAutonomy (agent and run)
 *  - better-n8n-frontend/src/components/runs/RunControls.tsx (which calls it uses)
 *
 * Paths are relative to /api; `api()` prepends it.
 */

import { api } from '../../api/client';
import type { ApiOptions } from '../../api/client';
import { evalsApi } from '../evals/api';
import type { CancelResult, SteerResult } from '../agents/types';
import type {
  BulkDeleteInput,
  BulkDeleteResult,
  CostBreakdown,
  CursorPage,
  ExecutionDetail,
  ExecutionLog,
  FailureCategory,
  FeedbackInput,
  FeedbackSummary,
  FeedbackTarget,
  InsightsOverview,
  LiveActivity,
  LiveItem,
  FileActivityItem,
  MarkFailedResult,
  QualitySummary,
  RecentFilesActivity,
  RunAutonomyLevel,
  RunCaller,
  RunStatus,
  SpendSummary,
} from './types';

type Query = NonNullable<ApiOptions['query']>;

/** Query for GET /logs/executions/. Type alias, not interface, so it fits `Query`. */
export type ExecutionListParams = {
  workflow_id?: number;
  status?: RunStatus;
  caller?: RunCaller;
  failure_category?: FailureCategory;
  limit?: number;
  cursor?: string | null;
};

const enc = encodeURIComponent;

/** Newest first. `cursor` comes from the previous page's `next_cursor`. */
export function listExecutions(params: ExecutionListParams = {}): Promise<CursorPage<ExecutionLog>> {
  return api<CursorPage<ExecutionLog>>('/logs/executions/', { query: { ...params } as Query });
}

/** One run in full, with its turns, steps, cost and feedback. */
export function getExecution(executionId: string): Promise<ExecutionDetail> {
  return api<ExecutionDetail>(`/logs/executions/${enc(executionId)}/`);
}

/**
 * Delete one finished run. 409 while it is live (stop it first) or eval-owned
 * (delete the sweep instead). Its turns and steps go; cost rows stay.
 */
export function deleteExecution(executionId: string): Promise<null> {
  return api<null>(`/logs/executions/${enc(executionId)}/`, { method: 'DELETE' });
}

/**
 * Delete many finished runs: `{ids}` or `{status, older_than_days}`. All or
 * nothing: a live or eval-owned row in the selection refuses the whole request.
 */
export function bulkDeleteExecutions(body: BulkDeleteInput): Promise<BulkDeleteResult> {
  return api<BulkDeleteResult>('/logs/executions/bulk-delete/', { method: 'POST', body });
}

/** Close one run stuck `running` as failed without waiting for the sweep. 409 for anything else. */
export function markExecutionFailed(executionId: string): Promise<MarkFailedResult> {
  return api<MarkFailedResult>(`/logs/executions/${enc(executionId)}/mark-failed/`, {
    method: 'POST',
    body: {},
  });
}

/** Thumbs up or down on a run or a chat message. PUT upserts. */
export function submitFeedback(input: FeedbackInput): Promise<{ feedback: FeedbackSummary }> {
  return api<{ feedback: FeedbackSummary }>('/logs/feedback/', { method: 'PUT', body: input });
}

/**
 * Clear the caller's thumbs. The API reads `target` and `id` from the query
 * string on DELETE, not from a body (API.md §6). 404 when there was nothing.
 */
export function clearFeedback(target: FeedbackTarget, id: string | number): Promise<{ cleared: boolean }> {
  return api<{ cleared: boolean }>('/logs/feedback/', {
    method: 'DELETE',
    query: { target, id },
  });
}

/** The Insights screen's one call. `compare` adds the previous window for deltas. */
export function getInsightsOverview(days = 30, compare = false): Promise<InsightsOverview> {
  return api<InsightsOverview>('/logs/insights/overview/', {
    query: { days, compare: compare ? true : undefined },
  });
}

export function getCostBreakdown(days = 30): Promise<CostBreakdown> {
  return api<CostBreakdown>('/logs/insights/costs/', { query: { days } });
}

export function getQualitySummary(days = 30): Promise<QualitySummary> {
  return api<QualitySummary>('/logs/insights/quality/', { query: { days } });
}

/** Month-to-date spend for the header line. Hide the line on failure rather than show zero. */
export function getSpendSummary(): Promise<SpendSummary> {
  return api<SpendSummary>('/logs/spend/summary/');
}

/** Every live process of any kind for the caller, newest first. */
export async function getLiveActivity(): Promise<LiveActivity> {
  const data = await api<{ items?: LiveItem[]; truncated?: boolean; note?: string }>('/activity/live/');
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    truncated: !!data?.truncated,
    note: typeof data?.note === 'string' ? data.note : '',
  };
}

/** Recent file and content activity, newest first. */
export async function getRecentFiles(): Promise<RecentFilesActivity> {
  const data = await api<{ items?: FileActivityItem[]; truncated?: boolean }>('/activity/recent-files/');
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    truncated: !!data?.truncated,
  };
}

// Run controls. Stop, and steer, and autonomy all answer 409 with the reason
// when the run has already ended; the message is the one to show.

/** Stop one run. */
export function cancelRun(executionId: string): Promise<CancelResult> {
  return api<CancelResult>(`/orchestrator/runs/${enc(executionId)}/cancel/`, { method: 'POST' });
}

/** Queue an instruction for one run, read at its next step. Addressed by execution. */
export function steerRun(executionId: string, message: string): Promise<SteerResult> {
  return api<SteerResult>(`/orchestrator/runs/${enc(executionId)}/steer/`, {
    method: 'POST',
    body: { message },
  });
}

/** Queue an instruction for an agent's running run (its latest). */
export function steerAgent(agentId: number, message: string): Promise<SteerResult> {
  return api<SteerResult>(`/orchestrator/agents/${agentId}/steer/`, {
    method: 'POST',
    body: { message },
  });
}

/** Loosen or tighten approvals for one running run, by execution. */
export function setRunAutonomy(
  executionId: string,
  level: RunAutonomyLevel,
): Promise<{ autonomy: string; execution_id: string }> {
  return api<{ autonomy: string; execution_id: string }>(
    `/orchestrator/runs/${enc(executionId)}/autonomy/`,
    { method: 'POST', body: { level } },
  );
}

/** Loosen or tighten approvals for an agent's running run. */
export function setAgentAutonomy(
  agentId: number,
  level: RunAutonomyLevel,
): Promise<{ autonomy: string; execution_id: string }> {
  return api<{ autonomy: string; execution_id: string }>(`/orchestrator/agents/${agentId}/autonomy/`, {
    method: 'POST',
    body: { level },
  });
}

/** Cancel a running chat turn. The server keeps what streamed so far as a partial answer. */
export function stopChatTurn(sessionId: string): Promise<unknown> {
  return api<unknown>(`/chat/sessions/${enc(sessionId)}/message/stop/`, { method: 'POST' });
}

/**
 * Stop whatever a live row is, by its kind. Mirrors LiveList.tsx's stop: chat
 * turns stop through the chat route, eval sweeps through the eval route, and
 * every other kind through the run cancel route.
 */
export function stopLiveItem(item: LiveItem): Promise<unknown> {
  if (item.kind === 'chat_turn') return stopChatTurn(item.id);
  if (item.kind === 'eval_sweep') return evalsApi.cancelRun(item.id);
  return cancelRun(item.id);
}
