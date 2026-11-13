/**
 * React Query hooks for evaluation.
 *
 * A sweep runs in the background, so the run screen re-reads it while it is still
 * live (`LIVE_RUN_STATUSES`), and the world screen re-reads while a generation is
 * `generating`. Both intervals stop on their own once the thing they watch settles.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { evalsApi } from './api';
import { LIVE_RUN_STATUSES, type EvalCase, type EvalSuite, type RunStatus, type Verdict } from './types';

/** How often a live run or a generating world is re-read while on screen. */
export const EVAL_POLL_MS = 3000;

export const evalKeys = {
  all: ['eval'] as const,
  suites: ['eval', 'suites'] as const,
  suite: (id: number) => ['eval', 'suites', id] as const,
  runs: (suiteId?: number) => ['eval', 'runs', { suite_id: suiteId ?? null }] as const,
  run: (runId: string) => ['eval', 'run', runId] as const,
  reviewQueue: (params: { suite_id?: number; run_id?: string }) =>
    ['eval', 'reviews', params] as const,
  graders: ['eval', 'graders'] as const,
  scorecard: (agentId: number) => ['eval', 'scorecard', agentId] as const,
  starterKits: (agentId?: number) => ['eval', 'starter-kits', agentId ?? null] as const,
  world: (suiteId: number) => ['eval', 'world', suiteId] as const,
  calibration: ['eval', 'calibration'] as const,
};

export function useEvalSuites() {
  return useQuery({
    queryKey: evalKeys.suites,
    queryFn: () => evalsApi.listSuites(),
  });
}

export function useEvalSuite(id: number) {
  return useQuery({
    queryKey: evalKeys.suite(id),
    queryFn: () => evalsApi.getSuite(id),
    enabled: Number.isFinite(id),
  });
}

/** Sweep history, newest first. Pass a suite id to narrow it to one suite. */
export function useEvalRuns(suiteId?: number) {
  return useQuery({
    queryKey: evalKeys.runs(suiteId),
    queryFn: () => evalsApi.listRuns(suiteId != null ? { suite_id: suiteId } : {}),
  });
}

/**
 * One sweep with its results. Re-read every few seconds while the sweep is still
 * running or queued; once it settles (including `awaiting_review`) it is left alone.
 */
export function useEvalRun(runId: string) {
  return useQuery({
    queryKey: evalKeys.run(runId),
    queryFn: () => evalsApi.getRun(runId),
    enabled: runId.length > 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status as RunStatus | undefined;
      return status && LIVE_RUN_STATUSES.includes(status) ? EVAL_POLL_MS : false;
    },
  });
}

export function useEvalReviewQueue(params: { suite_id?: number; run_id?: string } = {}) {
  return useQuery({
    queryKey: evalKeys.reviewQueue(params),
    queryFn: () => evalsApi.reviewQueue(params),
  });
}

export function useGraderCatalog() {
  return useQuery({
    queryKey: evalKeys.graders,
    queryFn: () => evalsApi.graderCatalog(),
    staleTime: 60 * 60 * 1000,
  });
}

export function useScorecard(agentId: number) {
  return useQuery({
    queryKey: evalKeys.scorecard(agentId),
    queryFn: () => evalsApi.scorecard(agentId),
    enabled: Number.isFinite(agentId),
  });
}

export function useStarterKits(agentId?: number) {
  return useQuery({
    queryKey: evalKeys.starterKits(agentId),
    queryFn: () => evalsApi.starterKits(agentId),
  });
}

export function useJudgeCalibration() {
  return useQuery({
    queryKey: evalKeys.calibration,
    queryFn: () => evalsApi.judgeCalibration(),
  });
}

/**
 * A suite's world. Re-read every few seconds while a generation is in flight
 * (`pending.status === 'generating'`), then left alone.
 */
export function useSuiteWorld(suiteId: number) {
  return useQuery({
    queryKey: evalKeys.world(suiteId),
    queryFn: () => evalsApi.getWorld(suiteId),
    enabled: Number.isFinite(suiteId),
    refetchInterval: (query) =>
      query.state.data?.pending?.status === 'generating' ? EVAL_POLL_MS : false,
  });
}

/** Every eval mutation can change the suite list, a suite, its runs or its world. Re-read all of them. */
function useEvalMutation<TVars, TData = unknown>(fn: (vars: TVars) => Promise<TData>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: evalKeys.all }),
  });
}

export function useCreateSuite() {
  return useEvalMutation((body: Partial<EvalSuite>) => evalsApi.createSuite(body));
}

export function useUpdateSuite() {
  return useEvalMutation(({ id, body }: { id: number; body: Partial<EvalSuite> }) =>
    evalsApi.updateSuite(id, body));
}

export function useDeleteSuite() {
  return useEvalMutation((id: number) => evalsApi.deleteSuite(id));
}

export function useCreateCase() {
  return useEvalMutation(({ suiteId, body }: { suiteId: number; body: Partial<EvalCase> }) =>
    evalsApi.createCase(suiteId, body));
}

export function useUpdateCase() {
  return useEvalMutation(({ caseId, body }: { caseId: number; body: Partial<EvalCase> }) =>
    evalsApi.updateCase(caseId, body));
}

export function useDeleteCase() {
  return useEvalMutation((caseId: number) => evalsApi.deleteCase(caseId));
}

/** Start a sweep. Resolves to the run id; the run continues on the server. */
export function useRunSuite() {
  return useEvalMutation(({ suiteId, body }: { suiteId: number; body?: { agent_id?: number; notes?: string } }) =>
    evalsApi.runSuite(suiteId, body));
}

export function useCancelRun() {
  return useEvalMutation((runId: string) => evalsApi.cancelRun(runId));
}

export function useDeleteRun() {
  return useEvalMutation((runId: string) => evalsApi.deleteRun(runId));
}

/** Record a verdict on one result. The server keeps the graders' own answer alongside it. */
export function useSubmitReview() {
  return useEvalMutation(
    ({
      resultId,
      verdict,
      comment,
      correctedAnswer,
    }: {
      resultId: number;
      verdict: Verdict;
      comment?: string;
      correctedAnswer?: string;
    }) =>
      evalsApi.submitReview(resultId, {
        verdict,
        comment,
        corrected_answer: correctedAnswer,
      }),
  );
}

export function useGenerateCases() {
  return useEvalMutation(
    ({ suiteId, body }: { suiteId: number; body?: { count?: number; focus?: string } }) =>
      evalsApi.generateCases(suiteId, body),
  );
}

export function useImportRunCases() {
  return useEvalMutation(
    ({
      suiteId,
      body,
    }: {
      suiteId: number;
      body?: { source?: 'all' | 'rated' | 'thumbs_down'; limit?: number };
    }) => evalsApi.importRuns(suiteId, body),
  );
}

export function useReviewDrafts() {
  return useEvalMutation(
    ({ suiteId, accept, reject }: { suiteId: number; accept?: number[]; reject?: number[] }) =>
      evalsApi.reviewDrafts(suiteId, { accept, reject }),
  );
}

export function useCaseFromRun() {
  return useEvalMutation((body: { execution_id: string; suite_id?: number }) =>
    evalsApi.caseFromRun(body));
}

export function useGenerateWorld() {
  return useEvalMutation(
    ({ suiteId, body }: { suiteId: number; body?: { focus?: string; cases?: number } }) =>
      evalsApi.generateWorld(suiteId, body),
  );
}

export function useAcceptWorld() {
  return useEvalMutation((worldId: number) => evalsApi.acceptWorld(worldId));
}

export function useDeleteWorld() {
  return useEvalMutation((worldId: number) => evalsApi.deleteWorld(worldId));
}

/** Clone a starter kit into a suite. Used by the creation wizard after an agent exists. */
export function useCloneStarter() {
  return useEvalMutation((body: { template: string; name?: string; agent_id?: number }) =>
    evalsApi.cloneStarter(body));
}
