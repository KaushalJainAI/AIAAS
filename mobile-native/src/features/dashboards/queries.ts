/**
 * React Query hooks for dashboards.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { deleteDashboard, getDashboard, listDashboards, refreshDashboard } from './api';
import type { RefreshedDashboard } from './types';

export const dashboardKeys = {
  all: ['dashboards'] as const,
  lists: ['dashboards', 'list'] as const,
  list: (scope?: 'platform') => ['dashboards', 'list', scope ?? 'mine'] as const,
  detail: (id: number) => ['dashboards', 'detail', id] as const,
};

export function useDashboards(scope?: 'platform') {
  return useQuery({
    queryKey: dashboardKeys.list(scope),
    queryFn: () => listDashboards(scope),
  });
}

export function useDashboard(id: number) {
  return useQuery({
    queryKey: dashboardKeys.detail(id),
    queryFn: () => getDashboard(id),
    enabled: Number.isFinite(id),
  });
}

/** Refresh one dashboard. The answer replaces its cached detail. */
export function useRefreshDashboard(id: number) {
  const queryClient = useQueryClient();
  return useMutation<RefreshedDashboard, Error, void>({
    mutationFn: () => refreshDashboard(id),
    onSuccess: (data) => {
      queryClient.setQueryData(dashboardKeys.detail(id), data);
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.lists });
    },
  });
}

/** Refresh any dashboard by id, for list rows. The answer replaces its cached detail. */
export function useRefreshAnyDashboard() {
  const queryClient = useQueryClient();
  return useMutation<RefreshedDashboard, Error, number>({
    mutationFn: (id) => refreshDashboard(id),
    onSuccess: (data) => {
      queryClient.setQueryData(dashboardKeys.detail(data.id), data);
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.lists });
    },
  });
}

/** Delete any dashboard by id, for list rows. */
export function useDeleteAnyDashboard() {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, number>({
    mutationFn: (id) => deleteDashboard(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: dashboardKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

/** Delete one dashboard: its detail is dropped and every list is refreshed. */
export function useDeleteDashboard(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteDashboard(id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: dashboardKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}
