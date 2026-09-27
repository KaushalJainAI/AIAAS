/**
 * Evaluation — suites of cases run against an agent, and the human review of
 * what the graders decided.
 *
 * The backend has had this surface since the eval app landed and nothing in
 * this app ever called it, so the whole feature was unreachable from the UI.
 *
 * One shape is worth knowing before reading the page: a run's score is
 * *provisional* until a person has answered the results queued for review.
 * `passed` is `null` while `status` is `awaiting_review`, and that is a real
 * state rather than a missing value — the page renders it as "awaiting review"
 * rather than as a failure or a blank.
 */
import apiClient from './client';

export type SupervisionPolicy = 'none' | 'failures' | 'disagreement' | 'sampled' | 'all';

export type RunStatus =
  | 'pending' | 'queued' | 'running' | 'awaiting_review' | 'completed' | 'failed' | 'cancelled';

export interface GraderSpec {
  type: string;
  [key: string]: unknown;
}

/** One row of `eval/graders.py::catalog()` — parameter *names*, not types. */
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
 * What an eval run wanted from a person. An eval never pauses: a call that
 * would have waited for approval, and every `ask_user` question, is recorded
 * here instead (`agents/agent/runtime.py::collect_intents`).
 */
export type EvalIntent =
  | { kind: 'approval'; tool: string; args?: Record<string, unknown>; sentence?: string; call_id?: string; iteration?: number }
  | { kind: 'question'; question: string; assumption?: string; call_id?: string; iteration?: number };

/** What an eval does with a call that would have paused: run it, or decline it. */
export type GatedCalls = 'run' | 'block';

/** Tag on a generated or imported case that has not been accepted yet. */
export const DRAFT_TAG = 'needs-review';

/** A generated or imported case nobody has accepted yet; the runner skips it. */
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
  tags: string[];
  is_active: boolean;
  case_count: number;
  last_run: LastRun | null;
  created_at: string;
  updated_at: string;
}

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
  /** null while `status` is `awaiting_review` — provisional, not missing. */
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
 * A reviewer's answer. `unsure` is a real third option, not a missing one:
 * the point of the review model is measuring how often people agree with the
 * graders, and forcing a coin-flip when the reviewer genuinely cannot tell
 * would corrupt exactly the number the feature exists to produce.
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
  /** What the run changed in the eval world: files written, mail sent, … */
  env_changes?: Record<string, unknown>;
  /** Feeds `/api/logs/executions/{id}/` — score straight to full trace. */
  execution_id: string | null;
  created_at: string;
}

export interface QueueItem extends EvalResult {
  suite_id: number;
  suite_name: string;
  run_id: string;
}

/** `health` is the backend's own summary; shape is left open deliberately. */
export interface SuiteListResponse {
  suites: EvalSuite[];
  health: unknown;
}

/**
 * One fake situation a suite's cases share. Draft until a person accepts it
 * on this page; a regenerated world is a new version, never an edit.
 */
export interface EvalWorld {
  id: number;
  suite: number;
  version: number;
  /** `generating` while the judge builds it in the background; `failed`
   * with `error_message` if that did not produce a usable world. */
  status: 'generating' | 'failed' | 'draft' | 'accepted';
  brief: string;
  surfaces: Record<string, unknown>;
  fixtures: Record<string, unknown>;
  facts: Array<{ key?: string; value?: unknown; statement?: string }>;
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

export interface SuiteWorld {
  live: EvalWorld | null;
  draft: EvalWorld | null;
  /** A generation still running, or the newest one that failed. */
  pending: EvalWorld | null;
  versions: number[];
}

/** 202 from generate: the world is being built in the background. */
export interface GeneratedWorld {
  world: EvalWorld;
}

const evalsService = {
  listSuites: async (): Promise<SuiteListResponse> => {
    const { data } = await apiClient.get<SuiteListResponse>('/eval/suites/');
    return { suites: data?.suites ?? [], health: data?.health ?? null };
  },

  createSuite: async (body: Partial<EvalSuite>): Promise<EvalSuite> => {
    const { data } = await apiClient.post<EvalSuite>('/eval/suites/', body);
    return data;
  },

  getSuite: async (id: number): Promise<SuiteDetail> => {
    const { data } = await apiClient.get<SuiteDetail>(`/eval/suites/${id}/`);
    return { ...data, cases: data?.cases ?? [] };
  },

  updateSuite: async (id: number, body: Partial<EvalSuite>): Promise<EvalSuite> => {
    const { data } = await apiClient.patch<EvalSuite>(`/eval/suites/${id}/`, body);
    return data;
  },

  deleteSuite: async (id: number): Promise<void> => {
    await apiClient.delete(`/eval/suites/${id}/`);
  },

  createCase: async (suiteId: number, body: Partial<EvalCase>): Promise<EvalCase> => {
    const { data } = await apiClient.post<EvalCase>(`/eval/suites/${suiteId}/cases/`, body);
    return data;
  },

  updateCase: async (caseId: number, body: Partial<EvalCase>): Promise<EvalCase> => {
    const { data } = await apiClient.patch<EvalCase>(`/eval/cases/${caseId}/`, body);
    return data;
  },

  deleteCase: async (caseId: number): Promise<void> => {
    await apiClient.delete(`/eval/cases/${caseId}/`);
  },

  /** 202 + a run id — a sweep is one agent run per case, so it never blocks. */
  runSuite: async (
    suiteId: number,
    body: { agent_id?: number; notes?: string } = {},
  ): Promise<{ run_id: string; suite_id: number; agent_id: number }> => {
    const { data } = await apiClient.post(`/eval/suites/${suiteId}/run/`, body);
    return data;
  },

  listRuns: async (params: { suite_id?: number } = {}): Promise<EvalRun[]> => {
    const { data } = await apiClient.get<{ runs?: EvalRun[] }>('/eval/runs/', { params });
    return data?.runs ?? [];
  },

  getRun: async (runId: string): Promise<EvalRun & { results: EvalResult[] }> => {
    const { data } = await apiClient.get(`/eval/runs/${runId}/`);
    return { ...data, results: data?.results ?? [] };
  },

  deleteRun: async (runId: string): Promise<void> => {
    await apiClient.delete(`/eval/runs/${runId}/`);
  },

  cancelRun: async (runId: string): Promise<void> => {
    await apiClient.post(`/eval/runs/${runId}/cancel/`, {});
  },

  reviewQueue: async (params: { suite_id?: number; run_id?: string } = {}): Promise<QueueItem[]> => {
    const { data } = await apiClient.get<{ queue?: QueueItem[] }>('/eval/reviews/pending/', { params });
    return data?.queue ?? [];
  },

  /** The verdict overrides the graders without overwriting `auto_passed`. */
  submitReview: async (
    resultId: number,
    body: { verdict: Verdict; comment?: string; corrected_answer?: string },
  ): Promise<{ deleted?: boolean }> => {
    const { data } = await apiClient.post(`/eval/results/${resultId}/review/`, body);
    return data;
  },

  graderCatalog: async (): Promise<GraderCatalogEntry[]> => {
    const { data } = await apiClient.get<{ graders?: GraderCatalogEntry[] }>('/eval/graders/');
    return data?.graders ?? [];
  },

  scorecard: async (agentId: number): Promise<unknown> => {
    const { data } = await apiClient.get(`/eval/agents/${agentId}/scorecard/`);
    return data;
  },

  starterKits: async (agentId?: number): Promise<{ kits: StarterKit[]; recommended: string[] }> => {
    const { data } = await apiClient.get('/eval/starter-kits/', {
      params: agentId ? { agent_id: agentId } : {},
    });
    return { kits: data?.kits ?? [], recommended: data?.recommended ?? [] };
  },

  cloneStarter: async (body: { template: string; name?: string; agent_id?: number }): Promise<SuiteDetail> => {
    const { data } = await apiClient.post('/eval/suites/from-template/', body);
    return data;
  },

  judgeCalibration: async (): Promise<unknown> => {
    const { data } = await apiClient.get('/eval/judge/calibration/');
    return data;
  },

  /** Drafts cases from the suite agent's configuration (judge model, billed). */
  generateCases: async (suiteId: number, body: { count?: number; focus?: string } = {}): Promise<GeneratedCases> => {
    const { data } = await apiClient.post<GeneratedCases>(`/eval/suites/${suiteId}/generate/`, body);
    return data;
  },

  /** Drafts cases from the suite agent's recent real runs. Free. */
  importRuns: async (
    suiteId: number, body: { source?: 'all' | 'rated' | 'thumbs_down'; limit?: number } = {},
  ): Promise<GeneratedCases> => {
    const { data } = await apiClient.post<GeneratedCases>(`/eval/suites/${suiteId}/import-runs/`, body);
    return data;
  },

  reviewDrafts: async (
    suiteId: number, body: { accept?: number[]; reject?: number[] },
  ): Promise<{ accepted: number; rejected: number; refused?: number[]; refused_reason?: string }> => {
    const { data } = await apiClient.post(`/eval/suites/${suiteId}/drafts/`, body);
    return data;
  },

  caseFromRun: async (body: { execution_id: string; suite_id?: number }): Promise<EvalCase> => {
    const { data } = await apiClient.post<EvalCase>('/eval/cases/from-run/', body);
    return data;
  },

  /** The suite's live (accepted) world and its newest draft, if any. */
  getWorld: async (suiteId: number): Promise<SuiteWorld> => {
    const { data } = await apiClient.get<SuiteWorld>(`/eval/suites/${suiteId}/world/`);
    return {
      live: data?.live ?? null, draft: data?.draft ?? null,
      pending: data?.pending ?? null, versions: data?.versions ?? [],
    };
  },

  /** Start judge-building a world and its cases (202; runs in the
   * background — poll `getWorld`). Drafts only; billed to the judge key. */
  generateWorld: async (
    suiteId: number, body: { focus?: string; cases?: number } = {},
  ): Promise<GeneratedWorld> => {
    const { data } = await apiClient.post<GeneratedWorld>(`/eval/suites/${suiteId}/world/generate/`, body);
    return data;
  },

  /** Accept a draft world. Older versions' cases go stale. */
  acceptWorld: async (worldId: number): Promise<EvalWorld> => {
    const { data } = await apiClient.post<EvalWorld>(`/eval/worlds/${worldId}/accept/`, {});
    return data;
  },

  /** Delete a draft world. Accepted worlds are history and refuse. */
  deleteWorld: async (worldId: number): Promise<void> => {
    await apiClient.delete(`/eval/worlds/${worldId}/`);
  },
};

export default evalsService;
