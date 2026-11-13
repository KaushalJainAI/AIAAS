/**
 * Runs, insights, live activity and spend: the wire shapes this feature reads.
 *
 * Copied from the web app so the two cannot disagree about a field name:
 *  - ExecutionLog, AgentTurn, AgentStep, DelegatedRun, CostFields, CostSource,
 *    RunCaller, RunStatus, CursorPage, TodoItem: re-exported from
 *    ../agents/types (which mirror better-n8n-frontend/src/api/logs.ts), so the
 *    agents and runs features share one definition.
 *  - ExecutionDetail extras, DelegatedBy, RevisionSummary, FeedbackSummary,
 *    Feedback input/result, bulk delete, mark-failed:
 *                             better-n8n-frontend/src/api/logs.ts
 *  - Insights types, CostBreakdown, QualitySummary:
 *                             better-n8n-frontend/src/api/logs.ts
 *  - LiveItem, LiveKind, FileActivity*: better-n8n-frontend/src/api/activity.ts
 *  - SpendSummary:            better-n8n-frontend/src/api/spend.ts
 *
 * Left out on purpose: the configuration-history (revisions list) endpoints,
 * which the run screen does not show on a phone, and `credits_used`, a column
 * nothing writes (the web keeps it on the wire for old clients only).
 */

import type {
  AgentStep,
  AgentTurn,
  Autonomy,
  CostFields,
  CostSource,
  CursorPage,
  DelegatedRun,
  ExecutionDetail as RunDetailBase,
  ExecutionLog,
  RunCaller,
  RunStatus,
  TodoItem,
} from '../agents/types';

export type {
  AgentStep,
  AgentTurn,
  CostFields,
  CostSource,
  CursorPage,
  DelegatedRun,
  ExecutionLog,
  RunCaller,
  RunStatus,
  TodoItem,
};

/** Why a run failed, as the server classifies it (`ExecutionLog.failure_category`). */
export type FailureCategory =
  | 'provider'
  | 'step_budget'
  | 'tool_error'
  | 'guardrail'
  | 'contract'
  | 'timeout'
  | 'cancelled'
  | 'interrupted'
  | 'other';

/** The statuses the bulk-delete endpoint accepts: terminal failure states only. */
export type BulkDeleteStatus = 'failed' | 'cancelled' | 'timeout';

/** Autonomy levels a running run can be moved to. `plan` is build-time only. */
export type RunAutonomyLevel = Exclude<Autonomy, 'plan'>;

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

/** The configuration revision a run executed under (`ExecutionDetail.revision`). */
export interface RevisionSummary {
  id: number;
  number: number;
  summary: string;
  source: 'create' | 'update' | 'backfill' | 'restore';
  created_at: string;
}

/** The caller's own thumbs on a run, as `feedback_for` returns it. No id. */
export interface FeedbackSummary {
  rating: 1 | -1;
  reason: string;
  comment: string;
}

/**
 * One run in full: `GET /logs/executions/{id}/`. Extends the agents' shape with
 * what the run screen reads on top: the revision it ran under, who delegated
 * it, the caller's feedback, and the delegation count.
 */
export interface ExecutionDetail extends RunDetailBase {
  error_node_id?: string;
  supervision_level?: string;
  /** The configuration this run actually executed under. */
  revision: RevisionSummary | null;
  delegated_by: DelegatedBy | null;
  /** How many runs this one delegated, at any depth. */
  delegated_run_count: number;
  feedback: FeedbackSummary | null;
}

// Feedback

export type FeedbackTarget = 'execution' | 'message';

/** PUT /logs/feedback/. Upserts; a second call replaces the first. */
export interface FeedbackInput {
  target: FeedbackTarget;
  id: string | number;
  rating: 1 | -1;
  reason?: string;
  comment?: string;
}

// Delete

/** POST /logs/executions/bulk-delete/: exactly one of `ids` or `status`. */
export interface BulkDeleteInput {
  ids?: string[];
  status?: BulkDeleteStatus;
  older_than_days?: number;
}

export interface BulkDeleteResult {
  deleted: number;
}

/** POST /logs/executions/{id}/mark-failed/. */
export interface MarkFailedResult {
  execution_id: string;
  status: string;
}

// Insights (GET /logs/insights/*)

/** Mirrors `logs.views.execution_statistics`. Scalars live under `summary`. */
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

/** Mirrors `logs.views.cost_breakdown`. */
export interface CostBreakdown {
  period_days: number;
  /** Always 0 (a column nothing writes). Use `total_cost_usd`. */
  total_credits: number;
  total_tokens: number;
  /** Agent runs only. `chat` and `all_cost_usd` add conversations. */
  total_cost_usd: string;
  total_cost_source?: CostSource;
  chat?: {
    messages: number;
    tokens: number;
    cost_usd: string;
    cost_source: CostSource;
    paid_by: { platform: number; own_key: number };
  };
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
    cost_source: CostSource;
    executions: number;
  }[];
  by_model: {
    model_id: string;
    provider: string;
    tokens: number;
    cost_usd: string;
    turns: number;
  }[];
  by_tool: { tool: string; count: number }[];
  /** Non-token spend (`CostEntry`): images, browser minutes, ... Rupees. */
  by_kind?: { kind: string; amount_inr: number; entries: number; estimated: number }[];
  agents_by_cost_source?: { billed: number; estimated: number; unpriced: number };
  daily_usage: { date: string | null; cost_usd: string; tokens: number }[];
}

/** Mirrors `logs.queries.quality_summary`. */
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
  example_execution_id?: string;
  example_error?: string;
}

/** Mirrors `logs.queries.insights_overview`: one call for the Insights screen. */
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
    median_approve_ms?: number | null;
  };
  /** Previous window of the same length — present only with `compare=true`. */
  previous?: {
    days: number;
    total_executions: number;
    success_rate: number;
    chat_messages: number;
    cost_usd: string;
  };
}

// Live activity (GET /activity/live/, /activity/recent-files/)

export type LiveKind = 'agent_run' | 'code_task' | 'eval_sweep' | 'eval_world' | 'chat_turn';

/** One live process. Only the controls named in `actions` exist for this row. */
export interface LiveItem {
  kind: LiveKind;
  id: string;
  title: string;
  status: string;
  started_at: string | null;
  elapsed_s: number | null;
  spend_rupees: number | null;
  actions: string[];
  href: string;
  /** Past its own run limit plus grace — offers "Mark as failed". */
  stuck?: boolean;
  caller?: string;
  is_delegated?: boolean;
  mission_id?: number | null;
  agent?: string;
  project?: string;
}

export interface LiveActivity {
  items: LiveItem[];
  truncated: boolean;
  note: string;
}

export type FileActivityKind = 'file_opened' | 'file_version' | 'code_change';

export interface FileActivityItem {
  kind: FileActivityKind;
  /** ISO time, newest first. */
  at: string | null;
  name: string;
  href: string;
  document_id?: number | null;
  app?: string;
  open_count?: number;
  source?: string;
  path?: string;
}

export interface RecentFilesActivity {
  items: FileActivityItem[];
  truncated: boolean;
}

// Spend (GET /logs/spend/summary/)

/** Month-to-date spend in rupees, total and by caller. */
export interface SpendSummary {
  month_rupees: number;
  by_caller?: Record<string, number>;
}
