import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import nodeService, { type AIProvider, type CatalogueMeta } from '../api/nodeService';
import { tokenManager } from '../api/client';

/**
 * The provider/model catalogue, fetched once per session rather than once per
 * component.
 *
 * Three components mount this on the chat route alone. With local `useState` +
 * `useEffect` each got its own request, and `getAIModels` appended a
 * `?t=${Date.now()}` cache-buster that defeated the HTTP cache too — so a
 * single page load asked the server the same question three times and cached
 * none of the answers. React Query dedupes by key across every consumer and
 * holds the result for the shared `staleTime`.
 *
 * Unauthenticated visitors are skipped via `enabled`: the endpoint requires
 * auth, and the public guest chat used to fill the console with 401s.
 */
export function useAIModels() {
  const authenticated = tokenManager.isAuthenticated();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () => nodeService.getAIModels(),
    enabled: authenticated,
  });

  /**
   * Live catalogue refresh (staff-only): re-diffs OpenRouter's `/v1/models`
   * against the held rows, then re-reads both catalogue consumers.
   *
   * Both keys — the agent builder keeps its own (`['agent-builder',
   * 'models']`) over the same underlying request, so invalidating only
   * `['ai-models']` would leave the builder showing the dead list.
   */
  const refreshCatalog = useCallback(async () => {
    const summary = await nodeService.refreshModels();
    await queryClient.invalidateQueries({ queryKey: ['ai-models'] });
    await queryClient.invalidateQueries({ queryKey: ['agent-builder', 'models'] });
    return summary;
  }, [queryClient]);

  return {
    providers: (data?.providers ?? []) as AIProvider[],
    meta: (data?.meta ?? null) as CatalogueMeta | null,
    isLoading: authenticated ? isLoading : false,
    error: (error as Error | null) ?? null,
    refresh: refetch,
    refreshCatalog,
  };
}
