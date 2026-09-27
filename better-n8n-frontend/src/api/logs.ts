/**
 * Logs Service — what an agent did, thought, and was configured as.
 *
 * A run is a loop of **turns**, not a list of steps: each turn is one pass of
 * the model, carrying the reasoning behind it, and the tool calls it issued
 * hang off it. Calls sharing a turn were decided together; calls in different
 * turns were not. Render them that way or the trace claims a causality the run
 * never had.
 *
 * `workflow_id` / `workflow_name` are frozen wire names. What they identify is
 * a SubAgent — the backend renames the column on the way out so that this app
 * and BrowserOS, which ship their own builds, do not have to move together.
 */

import apiClient from './client';

// Execution types

/** Who started a run. `trigger_type` says how; this says what. */
export type RunCaller = 'api' | 'chat' | 'orchestrator' | 'trigger' | 'eval' | 'mission';

export interface ExecutionLog extends CostFields {
  id?: number;
  execution_id: string;
  workflow_id: number;
  workflow_name: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
  trigger_type: string;
  caller: RunCaller;
  /** The mission this run belongs to, if it is one link in a chain. */
  mission_id?: number | null;
  /** Delegation depth. 0 is a run the user started. */
  depth: number;
  is_delegated: boolean;
  duration_ms: number | null;
  nodes_executed: number;
  tokens_used: number;
  error_message: string | null;
  started_at: string | null;
  created_at: string;
  completed_at: string | null;
}

/** One tool call, belonging to the turn that issued it. */
export interface AgentStep {
  id: number;
  /** The provider's tool-call id — what an approval resumes on. */
  call_id: string;
  tool: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  order: number;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  error_message: string | null;
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  /** Non-empty only on delegating steps (`invoke_subagent`, `run_agent`). */
  delegated_runs: DelegatedRun[];
}

/**
 * Where a cost figure came from.
 *
 * `unpriced` is not a zero — it means no price is on record for the model, and
 * rendering it as a number would claim a run was free when we simply do not
 * know. `formatCost` in `lib/cost.ts` is what enforces that distinction.
 */
export type CostSource = 'billed' | 'estimated' | 'unpriced';

/**
 * What a run or a turn consumed, in the buckets it was actually billed in.
 *
 * `input_tokens` EXCLUDES the cached ones, so the four are disjoint and sum to
 * the prompt plus the completion. `cost_usd` is a decimal string, never a
 * number: JSON has no decimal type and a cost that picks up binary drift on
 * the way here will not add up against the one the spend cap enforced.
 */
export interface CostFields {
  input_tokens: number;
  output_tokens: number;
  cached_read_tokens: number;
  cached_write_tokens: number;
  cost_usd: string;
  cost_source: CostSource;
}

export interface DelegatedRun {
  execution_id: string;
  workflow_id: number | null;
  workflow_name: string | null;
  status: string;
  /** The instruction the worker was given — it exists nowhere else. */
  task: string;
  index: number;
  tokens_used: number;
  duration_ms: number | null;
}

/** One pass of the model: what it thought, and what it decided to do next. */
export interface AgentTurn extends CostFields {
  index: number;
  decision: 'tools' | 'answer' | 'paused' | 'error';
  /** The model's reasoning for THIS turn. Capped; see `reasoning_truncated`. */
  reasoning: string;
  reasoning_truncated: boolean;
  content: string;
  content_truncated: boolean;
  provider: string;
  model_id: string;
  tokens: number;
  /** Reasoning tokens, a subset of `output_tokens`. Never billed separately. */
  reasoning_tokens: number;
  duration_ms: number | null;
  created_at: string;
  steps: AgentStep[];
}

/** The orchestrator's side of a delegated run: who asked, and why. */
export interface DelegatedBy {
  execution_id: string;
  workflow_id: number | null;
  workflow_name: string | null;
  tool: string;
  call_id: string;
  task: string;
  index: number;
  /** What the orchestrator was thinking when it handed this work over. */
  reasoning: string;
  turn_index: number | null;
}

export interface RevisionSummary {
  id: number;
  number: number;
  summary: string;
  source: 'create' | 'update' | 'backfill' | 'restore';
  created_at: string;
}

export interface ExecutionDetail extends ExecutionLog {
  turns: AgentTurn[];
  /** Steps whose turn row is missing — a backfilled run, or a failed write. */
  unattributed_steps: AgentStep[];
  step_total: number;
  steps_truncated: boolean;
  turn_total: number;
  turns_truncated: boolean;
  credits_used: number;
  supervision_level?: string;
  input_data: Record<string, unknown>;
  output_data: Record<string, unknown>;
  error_node_id: string;
  /** The configuration this run actually executed under. */
  revision: RevisionSummary | null;
  delegated_by: DelegatedBy | null;
  /** How many runs this one delegated, at any depth. */
  delegated_run_count: number;
  /**
   * This run's cost WITH its delegated workers. Separate from `cost_usd`
   * because an orchestrator's own spend is a rounding error next to its
   * workers', and one blended figure would hide which you are looking at.
   */
  cost_usd_total: string;
  cost_source_total: CostSource;
  tokens_used_total: number;
}

// Configuration history

export interface RevisionDiff {
  [field: string]: { from: unknown; to: unknown };
}

export interface AgentRevision {
  id: number;
  number: number;
  summary: string;
  source: 'create' | 'update' | 'backfill' | 'restore';
  diff: RevisionDiff;
  changed_by: string | null;
  /** Runs that executed under this revision — has it been tried enough to judge? */
  run_count: number;
  created_at: string;
}

export interface CursorPage<T> {
  results: T[];
  /** Only the uncursored first page carries a total; later pages send null. */
  count: number | null;
  limit: number;
  next_cursor: string | null;
  has_more: boolean;
}

export interface QualitySummary {
  days: number;
  by_failure_category: Record<string, number>;
  thumbs_up: number;
  thumbs_down: number;
  thumbs_down_by_reason: Record<string, number>;
  signals_by_kind: Record<string, number>;
  recent_thumbs_down: {
    type: string;
    id: string | number;
    agent: string;
    reason: string;
    comment: string;
  }[];
}

export interface OverviewToolRow {
  tool: string;
  calls: number;
  success_rate: number;
  failed: number;
  /** Latest failed run in the window — absent when nothing failed. */
  execution_id?: string;
  /** Truncated error excerpt from that run. */
  error?: string;
}

export interface OverviewAgentRow {
  workflow_id: number | null;
  workflow_name: string;
  runs: number;
  success_rate: number;
  failed: number;
  tokens: number;
  cost_usd: string;
  cost_source: CostSource;
  /** Latest failed run in the window — absent when nothing failed. */
  example_execution_id?: string;
  example_error?: string;
}

/** Mirrors `logs.queries.insights_overview` — the Insights page reads this. */
export interface InsightsOverview {
  days: number;
  runs: ExecutionStatistics;
  spend: CostBreakdown;
  quality: QualitySummary;
  tools: OverviewToolRow[];
  delegation: {
    delegated_runs: number;
    top_workers: { workflow_id: number | null; workflow_name: string; runs: number }[];
    top_orchestrators: { workflow_id: number | null; workflow_name: string; delegated_runs: number }[];
  };
  agents: {
    distinct: number;
    most_active: OverviewAgentRow[];
    most_expensive: OverviewAgentRow[];
    needs_attention: OverviewAgentRow[];
    pending_hitl: number;
    /** Median ms from HITL open to answer in the window; null when none answered. */
    median_approve_ms?: number | null;
  };
  /** Previous window of the same length — present only with `?compare=1`. */
  previous?: {
    days: number;
    total_executions: number;
    success_rate: number;
    chat_messages: number;
    cost_usd: string;
  };
}

// Insights types

/**
 * Mirrors `logs.views.execution_statistics`. The scalars live under `summary` —
 * they are NOT flat on the response, and `daily_trend` carries a per-day
 * `success` count alongside the total.
 */
export interface ExecutionStatistics {
  summary: {
    total_executions: number;
    successful: number;
    failed: number;
    /** Already a percentage (0-100), not a fraction. */
    success_rate: number;
    avg_duration_ms: number;
    total_nodes_executed: number;
    total_tokens_used: number;
  };
  by_status: Record<string, number>;
  by_trigger: Record<string, number>;
  by_caller: Record<RunCaller, number>;
  daily_trend: DailyTrendPoint[];
}

export interface DailyTrendPoint {
  /** null when the row's created_at was null; skip those points. */
  date: string | null;
  count: number;
  success: number;
}

/**
 * Mirrors `logs.queries.agent_metrics`. `success_rate` is already a percentage,
 * and `tool_success_rates` is keyed by tool name, mapping to an object.
 */
export interface WorkflowMetrics {
  workflow_id: number;
  workflow_name: string;
  total_executions: number;
  success_rate: number;
  avg_duration_ms: number;
  total_tokens_used: number;
  recent_executions: ExecutionLog[];
  revision_count: number;
  /** Keyed by tool name: "read_url fails half the time" is the actionable read. */
  tool_success_rates: Record<
    string,
    { success_rate: number; total_runs: number }
  >;
  error_hotspots: { tool: string; error_count: number }[];
}

/**
 * Mirrors `logs.views.cost_breakdown`. `by_workflow` keeps the `workflow_id` /
 * `workflow_name` wire names used everywhere else in `/api/logs/`, and
 * `by_tool` is a list, not a mapping.
 */
export interface CostBreakdown {
  period_days: number;
  /**
   * Always 0. `credits_used` is a column nothing has ever written, so this was
   * structurally zero for the life of the endpoint; it is kept on the wire so
   * an older client does not read `undefined`. Use `total_cost_usd`.
   */
  total_credits: number;
  total_tokens: number;
  /** Agent runs only. `chat` and `all_cost_usd` add conversations. */
  total_cost_usd: string;
  total_cost_source?: CostSource;
  /** Conversations, priced per answer. Absent on an older server. */
  chat?: {
    messages: number;
    tokens: number;
    cost_usd: string;
    cost_source: CostSource;
    /** How many answers each kind of key paid for. */
    paid_by: { platform: number; own_key: number };
  };
  /** Agents and chat together, labelled by the weaker of the two. */
  all_cost_usd?: string;
  all_cost_source?: CostSource;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cached_read_tokens: number;
  by_workflow: {
    workflow_id: number;
    workflow_name: string;
    tokens: number;
    cost_usd: string;
    /** `unpriced` when any of this agent's runs was — see `lib/cost.ts`. */
    cost_source: CostSource;
    executions: number;
  }[];
  /** Which model the money actually went to — `by_workflow` says which agent. */
  by_model: {
    model_id: string;
    provider: string;
    tokens: number;
    cost_usd: string;
    turns: number;
  }[];
  by_tool: { tool: string; count: number }[];
  /** Non-token spend (`CostEntry`): images, browser minutes, … Rupees, as stored. */
  by_kind?: { kind: string; amount_inr: number; entries: number; estimated: number }[];
  /** Agent runs by cost provenance — runs carry no payer column, so this is
   *  the honest split (chat already carries `paid_by`). */
  agents_by_cost_source?: { billed: number; estimated: number; unpriced: number };
  daily_usage: { date: string | null; cost_usd: string; tokens: number }[];
}

export const logsService = {

  /**
   * Get workflow metrics
   */
  async getWorkflowMetrics(workflowId: number): Promise<WorkflowMetrics> {
    const response = await apiClient.get<WorkflowMetrics>(
      `/logs/insights/workflow/${workflowId}/`
    );
    return response.data;
  },

  /**
   * Get cost breakdown
   */
  async getCostBreakdown(days: number = 30): Promise<CostBreakdown> {
    const response = await apiClient.get<CostBreakdown>('/logs/insights/costs/', {
      params: { days },
    });
    return response.data;
  },

  // ========== Executions ==========

  /**
   * List executions
   */
async listExecutions(params?: {
    workflow_id?: number;
    status?: string;
    caller?: RunCaller;
    failure_category?: string;
    limit?: number;
    cursor?: string | null;
  }): Promise<CursorPage<ExecutionLog>> {
    const response = await apiClient.get<CursorPage<ExecutionLog>>(
      '/logs/executions/',
      { params }
    );
    return response.data;
  },

  /**
   * Get execution detail
   */
  async getExecution(executionId: string): Promise<ExecutionDetail> {
    const response = await apiClient.get<ExecutionDetail>(`/logs/executions/${executionId}/`);
    return response.data;
  },

  /**
   * Delete one finished run. 409 while live (stop first) or eval-owned
   * (delete the sweep instead). Turns/steps/trace cascade; cost rows stay.
   */
  async deleteExecution(executionId: string): Promise<void> {
    await apiClient.delete(`/logs/executions/${executionId}/`);
  },

  /**
   * Delete many finished runs: `{ids}` or `{status, older_than_days}`.
   * All or nothing — any live or eval-owned row 409s the whole request.
   */
  async bulkDeleteExecutions(body: {
    ids?: string[];
    status?: 'failed' | 'cancelled' | 'timeout';
    older_than_days?: number;
  }): Promise<{ deleted: number }> {
    const { data } = await apiClient.post('/logs/executions/bulk-delete/', body);
    return data;
  },

  /**
   * Close one run stuck `running` as failed, without waiting for the sweep.
   * 409 for anything not running.
   */
  async markExecutionFailed(executionId: string): Promise<{ execution_id: string; status: string }> {
    const { data } = await apiClient.post(`/logs/executions/${executionId}/mark-failed/`, {});
    return data;
  },

  async submitFeedback(body: {
    target: 'execution' | 'message'; id: string | number;
    rating: 1 | -1; reason?: string; comment?: string;
  }): Promise<unknown> {
    const { data } = await apiClient.put('/logs/feedback/', body);
    return data;
  },

  async quality(days = 30): Promise<QualitySummary> {
    const { data } = await apiClient.get<QualitySummary>('/logs/insights/quality/', { params: { days } });
    return data;
  },

  /**
   * One call for the Insights page: runs, spend, tools, delegation, quality.
   * Prefer this over firing stats/costs/quality separately — the server joins
   * them and adds the tool-success, delegation and leaderboard answers none of
   * those endpoints give alone.
   */
  async getOverview(days: number = 30, compare = false): Promise<InsightsOverview> {
    const response = await apiClient.get<InsightsOverview>('/logs/insights/overview/', {
      params: { days, ...(compare ? { compare: true } : {}) },
    });
    return response.data;
  },

  // ========== Configuration history ==========

/**
 * One page of an agent's configuration changes, newest first, with its diff.
 *
 * Keyset-paged like the execution list: the history grows for the life of the
 * agent, so the builder asks for a handful and the history page walks the rest
 * with `next_cursor`. Only the uncursored first page carries a `count`.
 */
async listRevisions(
  agentId: number,
  params: { limit?: number; cursor?: string | null } = {}
): Promise<CursorPage<AgentRevision>> {
  const response = await apiClient.get<CursorPage<AgentRevision>>(
    `/logs/agents/${agentId}/revisions/`,
    {
      params: {
        ...(params.limit != null ? { limit: params.limit } : {}),
        ...(params.cursor ? { cursor: params.cursor } : {}),
      },
    }
  );
  return response.data;
},
};

export default logsService;
