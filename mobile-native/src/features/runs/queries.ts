/**
 * React Query hooks for runs, run detail, feedback, insights, live activity,
 * spend and run controls.
 *
 * Polling is decided by the screen, not here: every hook that ticks takes a
 * `watching` flag (from `useIsLive`, true only while the screen is focused and
 * the app is open) and does nothing when it is false.
 *
 * Keys: `runKeys.detail(id)` is the same key agents/queries.ts uses for
 * `useRun`, so a detail read by either screen is one cache entry, and every
 * `['runs', ...]` prefix invalidation reaches the agents screens too.
 *
 * Cancel and steer-by-execution hooks are re-exported from agents/queries.ts
 * rather than written twice; they already invalidate the right keys.
 */

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { isLiveStatus, RUN_POLL_MS } from '../agents/queries';
import {
  bulkDeleteExecutions,
  clearFeedback,
  deleteExecution,
  getCostBreakdown,
  getExecution,
  getInsightsOverview,
  getLiveActivity,
  getQualitySummary,
  getRecentFiles,
  getSpendSummary,
  listExecutions,
  markExecutionFailed,
  setAgentAutonomy,
  setRunAutonomy,
  steerAgent,
  submitFeedback,
  type ExecutionListParams,
} from './api';
import type { BulkDeleteInput, FeedbackInput, FeedbackTarget, RunAutonomyLevel } from './types';

export { useCancelRun, useSteerRun } from '../agents/queries';

/** How often the run list is re-read while a run in it is still going. */
export const RUN_LIST_POLL_MS = 10_000;
/** How often the live list is re-read while something is live. */
export const LIVE_POLL_MS = 5_000;

export const runKeys = {
  all: ['runs'] as const,
  list: (filters: RunListFilters) => ['runs', 'list', filters] as const,
  detail: (executionId: string) => ['runs', 'detail', executionId] as const,
  insights: (days: number, compare: boolean) => ['insights', 'overview', days, compare] as const,
  costs: (days: number) => ['insights', 'costs', days] as const,
  quality: (days: number) => ['insights', 'quality', days] as const,
  spend: ['spend', 'summary'] as const,
  live: ['activity', 'live'] as const,
  files: ['activity', 'files'] as const,
};

export type RunListFilters = Omit<ExecutionListParams, 'cursor'>;

/**
 * Runs in pages of `limit` (default 20), newest first. Follows `next_cursor`
 * via `fetchNextPage`. Re-reads every few seconds only while `watching` and a
 * run in the loaded pages can still change.
 */
export function useRunList(filters: RunListFilters = {}, watching = false) {
  return useInfiniteQuery({
    queryKey: runKeys.list(filters),
    queryFn: ({ pageParam }) =>
      listExecutions({ ...filters, limit: filters.limit ?? 20, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.has_more ? last.next_cursor : undefined),
    refetchInterval: (query) =>
      watching && query.state.data?.pages.some((page) => page.results.some((r) => isLiveStatus(r.status)))
        ? RUN_LIST_POLL_MS
        : false,
  });
}

/**
 * One run in full. While `watching` is true and the run is live it is re-read
 * every few seconds; the interval stops on its own once the run ends.
 */
export function useRunDetail(executionId: string, watching: boolean) {
  return useQuery({
    queryKey: runKeys.detail(executionId),
    queryFn: () => getExecution(executionId),
    enabled: executionId.length > 0,
    refetchInterval: (query) =>
      watching && isLiveStatus(query.state.data?.status) ? RUN_POLL_MS : false,
  });
}

/** Delete one finished run. Drops its detail from the cache and refreshes the lists. */
export function useDeleteRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (executionId: string) => deleteExecution(executionId),
    onSuccess: (_data, executionId) => {
      queryClient.removeQueries({ queryKey: runKeys.detail(executionId) });
      void queryClient.invalidateQueries({ queryKey: runKeys.all });
      void queryClient.invalidateQueries({ queryKey: runKeys.live });
    },
  });
}

/** Delete many finished runs at once. All or nothing on the server. */
export function useBulkDeleteRuns() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkDeleteInput) => bulkDeleteExecutions(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: runKeys.all });
      void queryClient.invalidateQueries({ queryKey: runKeys.live });
    },
  });
}

/** Close a stuck `running` run as failed. */
export function useMarkRunFailed(executionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => markExecutionFailed(executionId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: runKeys.detail(executionId) });
      void queryClient.invalidateQueries({ queryKey: runKeys.all });
      void queryClient.invalidateQueries({ queryKey: runKeys.live });
    },
  });
}

/** Thumbs up or down. Refreshes the run it is about and the quality counts. */
export function useSubmitFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: FeedbackInput) => submitFeedback(input),
    onSuccess: (_data, input) => {
      if (input.target === 'execution') {
        void queryClient.invalidateQueries({ queryKey: runKeys.detail(String(input.id)) });
      }
      void queryClient.invalidateQueries({ queryKey: ['insights', 'quality'] });
    },
  });
}

/** Remove the caller's thumbs on a run or message. */
export function useClearFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { target: FeedbackTarget; id: string | number }) =>
      clearFeedback(args.target, args.id),
    onSuccess: (_data, args) => {
      if (args.target === 'execution') {
        void queryClient.invalidateQueries({ queryKey: runKeys.detail(String(args.id)) });
      }
      void queryClient.invalidateQueries({ queryKey: ['insights', 'quality'] });
    },
  });
}

/** Insights for the last `days`. `keepPreviousData` keeps the screen steady while the window changes. */
export function useInsightsOverview(days = 30, compare = false) {
  return useQuery({
    queryKey: runKeys.insights(days, compare),
    queryFn: () => getInsightsOverview(days, compare),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useCostBreakdown(days = 30) {
  return useQuery({
    queryKey: runKeys.costs(days),
    queryFn: () => getCostBreakdown(days),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useQualitySummary(days = 30) {
  return useQuery({
    queryKey: runKeys.quality(days),
    queryFn: () => getQualitySummary(days),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/** Month-to-date spend. Changes only when a run finishes, so a minute of staleness is fine. */
export function useSpendSummary() {
  return useQuery({
    queryKey: runKeys.spend,
    queryFn: getSpendSummary,
    staleTime: 60 * 1000,
  });
}

/**
 * Every live process. Always read once; re-read every few seconds only while
 * `watching` and the list is non-empty.
 */
export function useLiveActivity(watching = false) {
  return useQuery({
    queryKey: runKeys.live,
    queryFn: getLiveActivity,
    refetchInterval: (query) =>
      watching && (query.state.data?.items.length ?? 0) > 0 ? LIVE_POLL_MS : false,
  });
}

export function useRecentFiles(enabled = true) {
  return useQuery({
    queryKey: runKeys.files,
    queryFn: getRecentFiles,
    enabled,
    staleTime: 60 * 1000,
  });
}

/** Steer an agent's running run (its latest). Prefer `useSteerRun` when you hold an execution id. */
export function useSteerAgent(agentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => steerAgent(agentId, message),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: runKeys.live });
    },
  });
}

/** Change one running run's approval level, by execution. */
export function useSetRunAutonomy(executionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (level: RunAutonomyLevel) => setRunAutonomy(executionId, level),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: runKeys.detail(executionId) });
    },
  });
}

/** Change an agent's running run's approval level. */
export function useSetAgentAutonomy(agentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (level: RunAutonomyLevel) => setAgentAutonomy(agentId, level),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: runKeys.live });
    },
  });
}
