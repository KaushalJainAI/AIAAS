/**
 * One change set for the undo screen. Mirrors the web's `useChangeSet`: it
 * loads once (and on pull-to-refresh, or after a revert), and never polls. A
 * run still going shows as `live`; the person comes back to look again.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getChangeSet, revertChangeSet, type RevertResult } from './api';

export const changeKeys = {
  set: (setId: number) => ['change-set', setId] as const,
};

export function useChangeSet(setId: number) {
  const queryClient = useQueryClient();
  const key = changeKeys.set(setId);

  const query = useQuery({
    queryKey: key,
    queryFn: () => getChangeSet(setId),
    enabled: Number.isInteger(setId) && setId > 0,
  });

  const revert = useMutation({
    mutationFn: (changeIds?: number[]) => revertChangeSet(setId, changeIds),
    // Reload the tree whether the revert worked or was refused, so the rows
    // show what is now true.
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  return {
    query,
    revert,
    /** What the last revert said, one outcome per change it touched. */
    result: (revert.data ?? null) as RevertResult | null,
  };
}
