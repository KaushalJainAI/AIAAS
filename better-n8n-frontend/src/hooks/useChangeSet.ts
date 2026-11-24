/**
 * One change set (a chat answer's or a run's changes) for the undo sheet.
 *
 * Loads when `setId` is set, and again after a revert. It never polls: a run
 * that is still going shows as `live`, and the person closes and reopens the
 * sheet to look again.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getChangeSet, revertChangeSet } from '@/api/changes';

export function useChangeSet(setId: number | null) {
  const queryClient = useQueryClient();
  const key = ['change-set', setId] as const;

  const query = useQuery({
    queryKey: key,
    queryFn: () => getChangeSet(setId as number),
    enabled: setId !== null,
    refetchOnWindowFocus: false,
  });

  const revert = useMutation({
    mutationFn: (changeIds?: number[]) => revertChangeSet(setId as number, changeIds),
    // Reload the tree whether the revert worked or was refused, so the rows
    // show what is now true.
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return {
    detail: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    reload: query.refetch,
    revert: revert.mutateAsync,
    reverting: revert.isPending,
    /** What the last revert said, one outcome per change it touched. */
    result: revert.data ?? null,
  };
}
