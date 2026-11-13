/**
 * React Query hooks for published pages. Keys are exported so other features
 * (files: sharing a file) invalidate the same lists.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getPage,
  getPublicPage,
  listPages,
  publishPage,
  withdrawPage,
} from './api';
import type { PageListScope, PublishPageInput, PublishedPage } from './types';

export const pageKeys = {
  all: ['pages'] as const,
  list: (scope?: PageListScope) => ['pages', 'list', scope ?? 'mine'] as const,
  page: (slug: string) => ['pages', 'page', slug] as const,
  publicPage: (slug: string) => ['pages', 'public', slug] as const,
};

/** The caller's pages, or everyone's listed pages with `scope='platform'`. */
export function usePages(scope?: PageListScope) {
  return useQuery({
    queryKey: pageKeys.list(scope),
    queryFn: () => listPages(scope),
  });
}

/** One page the signed-in user may read. */
export function usePage(slug: string) {
  return useQuery({
    queryKey: pageKeys.page(slug),
    queryFn: () => getPage(slug),
    enabled: slug.length > 0,
  });
}

/** One public page, read without an account. */
export function usePublicPage(slug: string) {
  return useQuery({
    queryKey: pageKeys.publicPage(slug),
    queryFn: () => getPublicPage(slug),
    enabled: slug.length > 0,
  });
}

/** Publish a snapshot. Every page list is stale afterwards. */
export function usePublishPage() {
  const queryClient = useQueryClient();
  return useMutation<PublishedPage, Error, PublishPageInput>({
    mutationFn: (input) => publishPage(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pageKeys.all });
    },
  });
}

/**
 * Unlist any page by its slug. Used by list rows, which cannot call the
 * per-page hook above for each row.
 */
export function useWithdrawAnyPage() {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: (slug) => withdrawPage(slug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pageKeys.all });
    },
  });
}

/** Unlist a page. Its own detail and every list are refreshed. */
export function useWithdrawPage(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => withdrawPage(slug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pageKeys.page(slug) });
      void queryClient.invalidateQueries({ queryKey: pageKeys.all });
    },
  });
}
