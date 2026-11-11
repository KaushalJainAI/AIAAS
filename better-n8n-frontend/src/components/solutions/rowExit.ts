/**
 * Optimistic changes to the team knowledge lists.
 *
 * A write that is about to take a row out of a list marks it `leaving` in every
 * cached list, in `onMutate`. `SolutionRow` plays its collapse for that mark, and
 * when the server answers, the list refetches and the row is gone for real. If
 * the write fails, `restoreRows` puts back the snapshot taken before the mark and
 * the row re-opens where it was.
 *
 * The mark lives in the cache, not in component state, so the row, the list and
 * the rollback all read one value, and a row that comes back later is not stuck
 * in a half-removed state.
 */
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';

import type { Solution, SolutionList } from '../../api/solutions';

/** A list row as the cache holds it: the server's row, plus the optimistic mark. */
export type ListRow = Solution & { leaving?: boolean };

/** What `restoreRows` puts back: every list as it was before the mark. */
export type ListSnapshot = [QueryKey, unknown][];

/** Every solutions query starts with `solutions`, so one prefix reaches all of them. */
const ROOT = 'solutions';

/** Applies `fn` to the rows of a list, whichever shape the query holds (paged or plain). */
function mapRows(data: unknown, fn: (rows: ListRow[]) => ListRow[]): unknown {
  if (!data || typeof data !== 'object') return data;
  if ('pages' in data) {
    const paged = data as InfiniteData<SolutionList>;
    return { ...paged, pages: paged.pages.map((page) => ({ ...page, solutions: fn(page.solutions) })) };
  }
  if ('solutions' in data) {
    const list = data as SolutionList;
    return { ...list, solutions: fn(list.solutions) };
  }
  // Insights and other non-list answers under the same prefix pass through untouched.
  return data;
}

/** Mark one row as leaving in every cached list. Returns what to restore if the write fails. */
export function markLeaving(qc: QueryClient, id: number): ListSnapshot {
  const snapshot = qc.getQueriesData<unknown>({ queryKey: [ROOT] });
  qc.setQueriesData<unknown>({ queryKey: [ROOT] }, (data: unknown) =>
    mapRows(data, (rows) => rows.map((row) => (row.id === id ? { ...row, leaving: true } : row))),
  );
  return snapshot;
}

/** Put every list back the way `markLeaving` found it. */
export function restoreRows(qc: QueryClient, snapshot: ListSnapshot): void {
  for (const [key, data] of snapshot) qc.setQueryData<unknown>(key, data);
}
