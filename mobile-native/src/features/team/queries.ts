/**
 * React Query hooks for team knowledge (solutions).
 *
 * Every key starts with `solutions` and carries the org, so one organisation's
 * list never answers for another's. Mutations invalidate the whole `solutions`
 * prefix: a publish, review or approval moves the list, the detail, the curator
 * queue and the insights at once, and a prefix is cheaper to reason about than
 * a hand-kept list of which ones.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { solutionsApi } from './api';
import { nextPageParam } from './page';
import type { DraftFields, OrgScope, ReviewKind, SolutionListOptions } from './types';

export const solutionKeys = {
  all: ['solutions'] as const,
  list: (org: OrgScope, opts: SolutionListOptions) =>
    ['solutions', 'list', org ?? 'personal', opts] as const,
  detail: (org: OrgScope, id: number) => ['solutions', 'detail', org ?? 'personal', id] as const,
  insights: (org: number) => ['solutions', 'insights', org] as const,
};

/** A page of the library, a search, or the attention view, for one org. */
export function useSolutions(org: OrgScope, opts: SolutionListOptions = {}, enabled = true) {
  return useQuery({
    queryKey: solutionKeys.list(org, opts),
    queryFn: () => solutionsApi.list(org, opts),
    enabled,
  });
}

/**
 * The same list, read a page at a time with "Load more" (the web's infinite
 * query). The key starts with `solutions`, so every write refreshes it.
 */
export function useSolutionPages(org: OrgScope, opts: SolutionListOptions = {}, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['solutions', 'pages', org ?? 'personal', opts],
    queryFn: ({ pageParam }) => solutionsApi.list(org, { ...opts, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: nextPageParam,
    enabled,
  });
}

/** Curators: what is waiting to go into the library. */
export function useCuratorQueue(org: number) {
  return useSolutions(org, { status: 'pending_review' });
}

export function useSolution(org: OrgScope, id: number) {
  return useQuery({
    queryKey: solutionKeys.detail(org, id),
    queryFn: () => solutionsApi.get(org, id),
    enabled: Number.isFinite(id),
  });
}

/** Curators only. Other callers get 403 and the query errors. */
export function useSolutionInsights(org: number) {
  return useQuery({
    queryKey: solutionKeys.insights(org),
    queryFn: () => solutionsApi.insights(org),
    enabled: Number.isFinite(org),
  });
}

function useSolutionMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: solutionKeys.all }),
  });
}

export function useCreateSolution() {
  return useSolutionMutation(({ org, fields, share }: { org: OrgScope; fields: DraftFields; share: boolean }) =>
    solutionsApi.create(org, fields, share));
}

export function useUpdateSolution() {
  return useSolutionMutation(
    ({ org, id, fields, verified }: { org: OrgScope; id: number; fields: DraftFields; verified?: boolean }) =>
      solutionsApi.update(org, id, fields, verified ?? false),
  );
}

export function useReviewSolution() {
  return useSolutionMutation(
    ({ org, id, kind, reason }: { org: OrgScope; id: number; kind: ReviewKind; reason?: string }) =>
      solutionsApi.review(org, id, kind, reason ?? ''),
  );
}

export function useSetSolutionShared() {
  return useSolutionMutation(({ org, id, shared }: { org: OrgScope; id: number; shared: boolean }) =>
    solutionsApi.setShared(org, id, shared));
}

export function usePublishSolution() {
  return useSolutionMutation(({ org, id, share }: { org: OrgScope; id: number; share: boolean }) =>
    solutionsApi.publish(org, id, share));
}

export function useDiscardSolution() {
  return useSolutionMutation(({ org, id }: { org: OrgScope; id: number }) =>
    solutionsApi.discard(org, id));
}

export function useApproveSolution() {
  return useSolutionMutation(({ org, id }: { org: OrgScope; id: number }) =>
    solutionsApi.approve(org, id));
}

export function useSendBackSolution() {
  return useSolutionMutation(({ org, id, reason }: { org: OrgScope; id: number; reason: string }) =>
    solutionsApi.sendBack(org, id, reason));
}

export function useRetractSolution() {
  return useSolutionMutation(({ org, id }: { org: OrgScope; id: number }) =>
    solutionsApi.retract(org, id));
}

export function useImportSolutionDocument() {
  return useSolutionMutation(({ org, documentId }: { org: OrgScope; documentId: number }) =>
    solutionsApi.importDocument(org, documentId));
}
