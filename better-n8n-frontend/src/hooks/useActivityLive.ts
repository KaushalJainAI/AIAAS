/**
 * The Activity live feed: one query key for the whole session.
 *
 * `useActivityLive` polls every 5s only while something is live (an empty
 * list is finished — new work arrives from a user action or a schedule, and
 * window focus revalidates on return). `useLiveCount` shares the key for nav
 * badges at a slower cadence; each mounted observer keeps its own timer.
 */
import { useQuery } from '@tanstack/react-query';
import activityService from '../api/activity';

export const ACTIVITY_LIVE_KEY = ['activity', 'live'];
export const ACTIVITY_FILES_KEY = ['activity', 'files'];

export function useActivityLive(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const query = useQuery({
    queryKey: ACTIVITY_LIVE_KEY,
    queryFn: () => activityService.live(),
    enabled,
    // Only poll while something can still change.
    refetchInterval: (q) =>
      (q.state.data?.items.length ?? 0) > 0 ? 5_000 : false,
  });
  return {
    items: query.data?.items ?? [],
    truncated: query.data?.truncated ?? false,
    note: query.data?.note ?? '',
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

/** Live-process count for nav badges. Slow poll; the page polls fast. */
export function useLiveCount(enabled = true): number {
  const query = useQuery({
    queryKey: ACTIVITY_LIVE_KEY,
    queryFn: () => activityService.live(),
    enabled,
    refetchInterval: 30_000,
    select: (data) => data.items.length,
  });
  return query.data ?? 0;
}

export function useActivityFiles(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const query = useQuery({
    queryKey: ACTIVITY_FILES_KEY,
    queryFn: () => activityService.recentFiles(),
    enabled,
    staleTime: 60 * 1000,
  });
  return {
    items: query.data?.items ?? [],
    truncated: query.data?.truncated ?? false,
    isLoading: query.isLoading,
  };
}
