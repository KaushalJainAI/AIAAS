/**
 * Evaluation over HTTP. Mirrors better-n8n-frontend/src/api/evals.ts, call for call.
 *
 * Backend: `eval/urls.py` and `eval/views.py` on `/api/eval/`. The judge and
 * generator calls are billed to the user's key, which is why the generation
 * routes are separate calls the screen makes on purpose.
 */
import { api } from '../../api/client';
import type {
  AgentScorecard,
  DraftReviewResult,
  EvalCase,
  EvalResult,
  EvalRun,
  EvalSuite,
  EvalWorld,
  GeneratedCases,
  GeneratedWorld,
  GraderCatalogEntry,
  JudgeCalibration,
  QueueItem,
  StarterKit,
  SuiteDetail,
  SuiteListResponse,
  SuiteWorld,
  Verdict,
} from './types';

export const evalsApi = {
  listSuites: async (): Promise<SuiteListResponse> => {
    const data = await api<SuiteListResponse | null>('/eval/suites/');
    return { suites: data?.suites ?? [], health: data?.health ?? null };
  },

  createSuite: (body: Partial<EvalSuite>) => api<EvalSuite>('/eval/suites/', { method: 'POST', body }),

  getSuite: async (id: number): Promise<SuiteDetail> => {
    const data = await api<SuiteDetail>(`/eval/suites/${id}/`);
    return { ...data, cases: data?.cases ?? [] };
  },

  updateSuite: (id: number, body: Partial<EvalSuite>) =>
    api<EvalSuite>(`/eval/suites/${id}/`, { method: 'PATCH', body }),

  deleteSuite: (id: number) => api<void>(`/eval/suites/${id}/`, { method: 'DELETE' }),

  createCase: (suiteId: number, body: Partial<EvalCase>) =>
    api<EvalCase>(`/eval/suites/${suiteId}/cases/`, { method: 'POST', body }),

  updateCase: (caseId: number, body: Partial<EvalCase>) =>
    api<EvalCase>(`/eval/cases/${caseId}/`, { method: 'PATCH', body }),

  deleteCase: (caseId: number) => api<void>(`/eval/cases/${caseId}/`, { method: 'DELETE' }),

  /** 202 and a run id. A sweep is one agent run per case, so it never blocks. */
  runSuite: (suiteId: number, body: { agent_id?: number; notes?: string } = {}) =>
    api<{ run_id: string; suite_id: number; agent_id: number }>(`/eval/suites/${suiteId}/run/`, {
      method: 'POST',
      body,
    }),

  listRuns: async (params: { suite_id?: number } = {}): Promise<EvalRun[]> => {
    const data = await api<{ runs?: EvalRun[] } | null>('/eval/runs/', { query: { suite_id: params.suite_id } });
    return data?.runs ?? [];
  },

  getRun: async (runId: string): Promise<EvalRun & { results: EvalResult[] }> => {
    const data = await api<EvalRun & { results?: EvalResult[] }>(`/eval/runs/${runId}/`);
    return { ...data, results: data?.results ?? [] };
  },

  /** Deletes a finished sweep and its eval-only history. Active sweeps refuse. */
  deleteRun: (runId: string) => api<void>(`/eval/runs/${runId}/`, { method: 'DELETE' }),

  cancelRun: (runId: string) => api<unknown>(`/eval/runs/${runId}/cancel/`, { method: 'POST', body: {} }),

  reviewQueue: async (params: { suite_id?: number; run_id?: string } = {}): Promise<QueueItem[]> => {
    const data = await api<{ queue?: QueueItem[] } | null>('/eval/reviews/pending/', {
      query: { suite_id: params.suite_id, run_id: params.run_id },
    });
    return data?.queue ?? [];
  },

  /** The verdict overrides the graders without overwriting `auto_passed`. */
  submitReview: (
    resultId: number,
    body: { verdict: Verdict; comment?: string; corrected_answer?: string },
  ) => api<{ deleted?: boolean }>(`/eval/results/${resultId}/review/`, { method: 'POST', body }),

  graderCatalog: async (): Promise<GraderCatalogEntry[]> => {
    const data = await api<{ graders?: GraderCatalogEntry[] } | null>('/eval/graders/');
    return data?.graders ?? [];
  },

  /** Scores per suite over time for one agent. Shape left open, as on the web. */
  scorecard: (agentId: number) => api<AgentScorecard>(`/eval/agents/${agentId}/scorecard/`),

  starterKits: async (agentId?: number): Promise<{ kits: StarterKit[]; recommended: string[] }> => {
    const data = await api<{ kits?: StarterKit[]; recommended?: string[] } | null>('/eval/starter-kits/', {
      query: { agent_id: agentId },
    });
    return { kits: data?.kits ?? [], recommended: data?.recommended ?? [] };
  },

  /** Clone a starter kit into a suite of the caller's own. */
  cloneStarter: (body: { template: string; name?: string; agent_id?: number }) =>
    api<SuiteDetail>('/eval/suites/from-template/', { method: 'POST', body }),

  /** Latest judge calibration. Shape left open, as on the web. */
  judgeCalibration: () => api<JudgeCalibration>('/eval/judge/calibration/'),

  /** Drafts cases from the suite agent's configuration. The judge model is billed. */
  generateCases: (suiteId: number, body: { count?: number; focus?: string } = {}) =>
    api<GeneratedCases>(`/eval/suites/${suiteId}/generate/`, { method: 'POST', body }),

  /** Drafts cases from the suite agent's recent real runs. Free. */
  importRuns: (
    suiteId: number,
    body: { source?: 'all' | 'rated' | 'thumbs_down'; limit?: number } = {},
  ) => api<GeneratedCases>(`/eval/suites/${suiteId}/import-runs/`, { method: 'POST', body }),

  reviewDrafts: (suiteId: number, body: { accept?: number[]; reject?: number[] }) =>
    api<DraftReviewResult>(`/eval/suites/${suiteId}/drafts/`, { method: 'POST', body }),

  caseFromRun: (body: { execution_id: string; suite_id?: number }) =>
    api<EvalCase>('/eval/cases/from-run/', { method: 'POST', body }),

  /** The suite's live (accepted) world, its newest draft, and any pending generation. */
  getWorld: async (suiteId: number): Promise<SuiteWorld> => {
    const data = await api<SuiteWorld | null>(`/eval/suites/${suiteId}/world/`);
    return {
      live: data?.live ?? null,
      draft: data?.draft ?? null,
      pending: data?.pending ?? null,
      versions: data?.versions ?? [],
    };
  },

  /**
   * Start judge-building a world and its cases. Answers 202 and runs in the
   * background: poll `getWorld`. Drafts only, billed to the judge key.
   */
  generateWorld: (suiteId: number, body: { focus?: string; cases?: number } = {}) =>
    api<GeneratedWorld>(`/eval/suites/${suiteId}/world/generate/`, { method: 'POST', body }),

  /** Accept a draft world. Older versions' cases go stale. */
  acceptWorld: (worldId: number) =>
    api<EvalWorld>(`/eval/worlds/${worldId}/accept/`, { method: 'POST', body: {} }),

  /** Delete a draft world. Accepted worlds are history and the server refuses. */
  deleteWorld: (worldId: number) => api<void>(`/eval/worlds/${worldId}/`, { method: 'DELETE' }),
};
