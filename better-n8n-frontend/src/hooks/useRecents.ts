/**
 * Recently opened files, from the app's side (`api/recents.ts`).
 *
 * * `useRecordOpen` tells the server a file was opened, once per file per
 *   mount. A ref, not state, guards it, so StrictMode's double effect and
 *   ordinary re-renders do not count one open twice.
 * * `useRecentFiles` reads the list, for the launcher and an app's welcome
 *   screen.
 * * `useViewState` is where a viewer keeps its place: it reads what was saved
 *   last time and saves changes debounced, flushing on unmount so the last
 *   page turn before closing is kept.
 *
 * All of it is best effort. A failed write costs the recents list an entry,
 * never the file the user is looking at.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { recentsService, type ViewState } from '../api/recents';

const SAVE_DELAY_MS = 800;

export function useRecordOpen(docId: number | null, app: string) {
  const qc = useQueryClient();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (docId === null) return;
    const key = `${app}:${docId}`;
    if (last.current === key) return;
    last.current = key;
    recentsService
      .recordOpen(docId, app)
      .then(() => qc.invalidateQueries({ queryKey: ['recents', 'list'] }))
      .catch(() => undefined);
  }, [docId, app, qc]);
}

export function useRecentFiles(opts: { app?: string; types?: string[]; limit?: number } = {}) {
  const { app, types, limit } = opts;
  return useQuery({
    queryKey: ['recents', 'list', app ?? '', types?.join(',') ?? '', limit ?? 0],
    queryFn: () => recentsService.list({ app, types, limit }),
    staleTime: 30_000,
  });
}

export function useViewState(docId: number) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['recents', 'state', docId],
    queryFn: () => recentsService.viewState(docId),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  const pending = useRef<ViewState | null>(null);
  const timer = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const state = pending.current;
    pending.current = null;
    if (state) void recentsService.saveViewState(docId, state).catch(() => undefined);
  }, [docId]);

  const save = useCallback(
    (state: ViewState) => {
      pending.current = state;
      qc.setQueryData(['recents', 'state', docId], state);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
    },
    [docId, flush, qc],
  );

  useEffect(() => flush, [flush]);

  return {
    /** What was saved last time; `{}` when nothing was. */
    initial: query.data ?? {},
    /** False until the saved state has loaded or failed to. */
    ready: query.isFetched || query.isError,
    save,
  };
}
