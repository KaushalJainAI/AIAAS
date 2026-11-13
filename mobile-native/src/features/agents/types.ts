/**
 * Agents and runs: the wire shapes this feature reads. Read-only on mobile.
 *
 * Copied from the web app so the two cannot disagree about a field name:
 *  - Agent, AgentRunStarted:  better-n8n-frontend/src/api/agents.ts
 *  - AgentConfig subset, AgentStatus, Autonomy:
 *                             better-n8n-frontend/src/types/agentConfig.ts
 *  - ExecutionLog, ExecutionDetail, AgentTurn, AgentStep, DelegatedRun,
 *    CostFields, CostSource, RunCaller, CursorPage:
 *                             better-n8n-frontend/src/api/logs.ts
 *  - TodoItem:                better-n8n-frontend/src/api/chat.ts
 *
 * Deliberately left out: the revision, delegation-by and insight types, which
 * the run screen does not show on a phone.
 */

export type AgentStatus = 'draft' | 'active' | 'paused' | 'archived';
export type Autonomy = 'plan' | 'review' | 'ask' | 'auto' | 'full';

/** The part of AgentConfig (web) this screen reads. Field names are the wire names. */
export interface AgentConfigSummary {
  name: string;
  brief: string;
  description: string;
  tags: string[];
  status: AgentStatus;
  provider: string;
  model: string;
  autonomy: Autonomy;
  /** Cron expression for the agent's own schedule, or '' for none. */
  schedule: string;
  scheduleTimezone: string;
  allowUnattended: boolean;
  /** Read-only: how many other schedules this agent has. */
  extraSchedules?: number;
}

/** An agent as the server returns it: the config, plus what actually happened. */
export interface Agent extends AgentConfigSummary {
  id: number;
  /** Counted from the execution log, not stored. */
  runs: number;
  /** Runs that raised no approval request. */
  unattended: number;
  /** Spend across those runs (the same figure the spend cap is checked against). */
  spend: number;
  template_slug?: string | null;
  /** `retired` when the configured model's catalogue row is inactive. */
  model_status?: 'ok' | 'retired';
  created_at: string;
  updated_at: string;
}

/** What starting a run returns: an id to watch, not an answer. */
export interface AgentRunStarted {
  execution_id: string;
  status: string;
  unserved_grants: string[];
}

/** POST runs/{id}/steer/ and agents/{id}/steer/ both answer this. */
export interface SteerResult {
  steered: boolean;
  execution_id: string;
  queued: number;
  dropped: number;
}

/** POST runs/{id}/cancel/ answers this. 409 carries why it cannot be stopped. */
export interface CancelResult {
  execution_id: string;
  status: string;
}

export interface CursorPage<T> {
  results: T[];
  count: number | null;
  limit: number;
  next_cursor: string | null;
  has_more: boolean;
}

export type RunCaller = 'api' | 'chat' | 'orchestrator' | 'trigger' | 'eval' | 'mission';
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';

/**
 * Where a cost figure came from. `unpriced` is not a zero: it means no price is
 * on record, so the screen must not show it as a number.
 */
export type CostSource = 'billed' | 'estimated' | 'unpriced';

export interface CostFields {
  input_tokens: number;
  output_tokens: number;
  cached_read_tokens: number;
  cached_write_tokens: number;
  /** A decimal string, never a number. */
  cost_usd: string;
  cost_source: CostSource;
}

/** One run, as a row of the list endpoint. */
export interface ExecutionLog extends CostFields {
  id?: number;
  execution_id: string;
  /** The agent this run belongs to. Null once the agent is deleted. */
  workflow_id: number | null;
  workflow_name: string | null;
  status: RunStatus;
  trigger_type: string;
  caller: RunCaller;
  mission_id?: number | null;
  /** Delegation depth. 0 is a run the user started. */
  depth: number;
  is_delegated: boolean;
  duration_ms: number | null;
  nodes_executed: number;
  tokens_used: number;
  error_message: string | null;
  failure_category?: string | null;
  started_at: string | null;
  created_at: string;
  completed_at: string | null;
}

/** One tool call, belonging to the turn that issued it. */
export interface AgentStep {
  id: number;
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
  delegated_runs: DelegatedRun[];
}

export interface DelegatedRun {
  execution_id: string;
  workflow_id: number | null;
  workflow_name: string | null;
  status: string;
  task: string;
  index: number;
  tokens_used: number;
  duration_ms: number | null;
}

/** One pass of the model: the decision it made, and the tool calls it issued. */
export interface AgentTurn extends CostFields {
  index: number;
  decision: 'tools' | 'answer' | 'paused' | 'error';
  reasoning: string;
  reasoning_truncated: boolean;
  content: string;
  content_truncated: boolean;
  provider: string;
  model_id: string;
  tokens: number;
  reasoning_tokens: number;
  duration_ms: number | null;
  created_at: string;
  steps: AgentStep[];
}

/** One item of the plan the run keeps (`output_data.todos`). */
export interface TodoItem {
  text: string;
  status: 'open' | 'doing' | 'done' | 'blocked';
  owner?: string;
  task_id?: string;
  /** Why a step is blocked, or what it waits on. */
  note?: string;
}

/** One run in full: `GET /logs/executions/{id}/`. */
export interface ExecutionDetail extends ExecutionLog {
  turns: AgentTurn[];
  unattributed_steps: AgentStep[];
  step_total: number;
  steps_truncated: boolean;
  turn_total: number;
  turns_truncated: boolean;
  input_data: Record<string, unknown>;
  output_data: Record<string, unknown>;
  /** This run's cost with its delegated workers included. */
  cost_usd_total: string;
  cost_source_total: CostSource;
  tokens_used_total: number;
}
