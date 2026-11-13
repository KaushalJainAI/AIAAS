import { useCallback, useState } from 'react';

/**
 * Pull-to-refresh state for a react-query `refetch`. Stays "refreshing" until
 * the refetch settles, whether it succeeds or fails, so the spinner always goes.
 *
 * @example
 *   const { refreshing, onRefresh } = useRefresh(query.refetch);
 *   <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
 */
export function useRefresh(refetch: () => Promise<unknown>): { refreshing: boolean; onRefresh: () => void } {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refetch()
      .catch(() => {
        // The query holds the error and the screen shows it; the spinner just stops.
      })
      .finally(() => setRefreshing(false));
  }, [refetch]);

  return { refreshing, onRefresh };
}
