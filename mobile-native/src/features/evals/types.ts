/**
 * Evaluation: suites of cases run against an agent, and the human review of what
 * the graders decided.
 *
 * Copied from better-n8n-frontend/src/api/evals.ts, with the same names.
 *
 * A run's score is *provisional* until a person has answered the results queued
 * for review. `passed` is `null` while `status` is `awaiting_review`, and that is a
 * real state rather than a missing value: show it as "awaiting review", not as a
 * failure or a blank.
 */

export type SupervisionPolicy = 'none' | 'failures' | 'disagreement' | 'sampled' | 'all';

export type RunStatus =
  | 'pending' | 'queued' | 'running' | 'awaiting_review' | 'completed' | 'failed' | 'cancelled';

/** Statuses that can still change, so a screen keeps re-reading the run while one is shown. */
export const LIVE_RUN_STATUSES: readonly RunStatus[] = ['pending', 'queued', 'running'];

export interface GraderSpec {
  type: string;
  [key: string]: unknown;
}

/** One row of `eval/graders.py::catalog()`. Parameter *names*, not types. */
export interface GraderCatalogEntry {
  type: string;
  params: string[];
  required: string[];
  /** A model grades it (`llm_judge`): a case cannot rely on these alone. */
  calls_model: boolean;
  description: string;
}

export interface EvalCase {
  id: number;
  suite: number;
  name: string;
  order: number;
  goal: string;
  input_data: Record<string, unknown>;
  reference: string;
  graders: GraderSpec[];
  weight: number;
  tags: string[];
  is_active: boolean;
  /** The world version this case was built for; null predates worlds. */
  world_version: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * What an eval run wanted from a person. An eval never pauses: a call that would
 * have waited for approval, and every `ask_user` question, is recorded here instead.
 */
export type EvalIntent =
  | { kind: 'approval'; tool: string; args?: Record<string, unknown>; sentence?: string; call_id?: string; iteration?: number }
  | { kind: 'question'; question: string; assumption?: string; call_id?: string; iteration?: number };

/** What an eval does with a call that would have paused: run it, or decline it. */
export type GatedCalls = 'run' | 'block';

/** Tag on a generated or imported case that has not been accepted yet. */
export const DRAFT_TAG = 'needs-review';

/** A generated or imported case nobody has accepted yet. The runner skips it. */
export function isDraft(c: EvalCase): boolean {
  return !c.is_active && c.tags.includes(DRAFT_TAG);
}

export interface GeneratedCases {
  cases: EvalCase[];
  /** Why drafted cases were thrown away (e.g. named a tool the agent lacks). */
  rejected?: string[];
  already_imported?: number;
  cost_usd?: string | null;
}

export interface LastRun {
  run_id: string;
  status: RunStatus;
  score: number | null;
  passed: boolean | null;
  pending_review: number;
  created_at: string;
}

export interface StarterKit {
  slug: string;
  name: string;
  description: string;
  case_count: number;
}

export interface EvalSuite {
  id: number;
  name: string;
  slug: string;
  description: string;
  template_slug?: string | null;
  subagent: number | null;
  pass_threshold: number;
  supervision: SupervisionPolicy;
  sample_percent: number;
  reviewer: number | null;
  concurrency: number;
  gated_calls: GatedCalls;
  /**
   * Spend ceiling for one sweep, in rupees. The suite serializer sends it, but
   * the web type does not declare it, so it is optional here as well.
   */
  max_cost_rupees?: number;
  tags: string[];
  is_active: boolean;
  case_count: number;
  last_run: LastRun | null;
  created_at: string;
  updated_at: string;
}

/** `GET suites/{id}/`: the suite with its cases in order. */
export interface SuiteDetail extends EvalSuite {
  cases: EvalCase[];
}

export interface EvalRun {
  run_id: string;
  suite: number;
  suite_name: string;
  subagent: number | null;
  agent_name: string;
  revision: number | null;
  revision_number: number | null;
  status: RunStatus;
  supervision: SupervisionPolicy;
  total_cases: number;
  passed_count: number;
  failed_count: number;
  error_count: number;
  pending_review_count: number;
  score: number | null;
  /** 0-100 display form of score. Null while provisional. */
  score_100: number | null;
  /** Null while `status` is `awaiting_review`: provisional, not missing. */
  passed: boolean | null;
  /** How often a human agreed with the graders. The number that matters. */
  grader_agreement: number | null;
  tokens_used: number;
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string;
  notes: string;
  /** The world version this sweep ran on; null for world-less suites. */
  world_version: number | null;
  created_at: string;
}

/**
 * A reviewer's answer. `unsure` is a real third option, not a missing one: forcing
 * a coin-flip when the reviewer cannot tell would corrupt the agreement number.
 */
export type Verdict = 'pass' | 'fail' | 'unsure';

export interface EvalReview {
  id: number;
  verdict: Verdict;
  /** Whether this verdict matched `auto_passed`. Feeds `grader_agreement`. */
  agreed_with_graders: boolean | null;
  comment: string;
  corrected_answer: string;
  reviewer: number | null;
  reviewer_name: string;
  created_at: string;
  updated_at: string;
}

export interface ResultFlags {
  gave_up: boolean;
  guardrail: boolean;
  hallucination: boolean;
  out_of_scope: boolean;
}

export interface EvalResult {
  id: number;
  run: string;
  case: number | null;
  case_name: string;
  goal: string;
  status: string;
  answer: string;
  answer_truncated: boolean;
  /** The graders' answer, kept for ever so agreement stays computable. */
  auto_passed: boolean | null;
  auto_score: number | null;
  auto_score_100: number | null;
  grades: unknown;
  weight: number;
  review_state: string;
  review_reason: string;
  review: EvalReview | null;
  /** The review's verdict when there is one, else the graders'. */
  final_passed: boolean | null;
  final_score: number;
  /** 0-100 display form of final_score. Null while provisional. */
  final_score_100: number | null;
  flags: ResultFlags;
  tokens: number;
  duration_ms: number | null;
  error_message: string;
  intents?: EvalIntent[];
  /** What the run changed in the eval world: files written, mail sent, and so on. */
  env_changes?: Record<string, unknown>;
  /** Feeds `/api/logs/executions/{id}/`: a score straight to its full trace. */
  execution_id: string | null;
  created_at: string;
}

export interface QueueItem extends EvalResult {
  suite_id: number;
  suite_name: string;
  run_id: string;
}

/** `GET suites/`: the list plus the backend's own health summary, whose shape is left open. */
export interface SuiteListResponse {
  suites: EvalSuite[];
  health: unknown;
}

/**
 * One fake situation a suite's cases share. Draft until a person accepts it. A
 * regenerated world is a new version, never an edit.
 */
export interface EvalWorld {
  id: number;
  suite: number;
  version: number;
  /**
   * `generating` while the judge builds it in the background; `failed` with
   * `error_message` if that did not produce a usable world.
   */
  status: 'generating' | 'failed' | 'draft' | 'accepted';
  brief: string;
  surfaces: Record<string, unknown>;
  fixtures: Record<string, unknown>;
  facts: { key?: string; value?: unknown; statement?: string }[];
  created_by_model: string;
  cost_usd: string | null;
  error_message: string;
  focus: string;
  requested_cases: number;
  /** Cases the pipeline threw out, with the reason for each. */
  rejected: string[];
  case_count: number;
  is_live: boolean;
  created_at: string;
  updated_at: string;
}

/** `GET suites/{id}/world/`. */
export interface SuiteWorld {
  live: EvalWorld | null;
  draft: EvalWorld | null;
  /** A generation still running, or the newest one that failed. */
  pending: EvalWorld | null;
  versions: number[];
}

/** 202 from `world/generate/`: the world is being built in the background. */
export interface GeneratedWorld {
  world: EvalWorld;
}

/** `POST suites/{id}/drafts/` answer. */
export interface DraftReviewResult {
  accepted: number;
  rejected: number;
  refused?: number[];
  refused_reason?: string;
}

/** One sweep on an agent's scorecard. `score_100` is the 0-100 display form. */
export interface ScorecardPoint {
  run_id: string;
  score: number | null;
  score_100: number | null;
  passed: boolean | null;
  status: RunStatus;
  revision: number | null;
  grader_agreement: number | null;
  created_at: string;
}

/** Per suite: the latest settled sweep (never a provisional one), and recent history. */
export interface ScorecardSuite {
  suite_id: number;
  suite_name: string;
  latest: ScorecardPoint | null;
  awaiting_review: number;
  history: ScorecardPoint[];
}

/** `GET agents/{id}/scorecard/`. */
export interface AgentScorecard {
  agent_id: number;
  agent_name: string;
  suites: ScorecardSuite[];
}

/** `GET judge/calibration/`: the latest calibration per source. */
export interface JudgeCalibration {
  calibrations?: Record<
    string,
    { judge_model: string; agreement: number; false_pass_rate: number; created_at: string }
  >;
}
