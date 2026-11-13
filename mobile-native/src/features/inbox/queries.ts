import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import { useIsLive } from '../../hooks/usePolling';
import type { HITLRequest, HITLResponseBody, InboxNotification } from './types';

/** Pending requests are polled this often, only while the Inbox is on screen and the app is open. */
export const PENDING_POLL_MS = 30_000;

const INBOX_KEY = ['inbox'] as const;
const PENDING_KEY = ['inbox', 'pending'] as const;
const NOTIFICATIONS_KEY = ['inbox', 'notifications'] as const;

/** DRF returns a bare list or `{results}` depending on pagination; accept both. Mirrors `asArray` in the web. */
function listOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const results = (data as { results?: unknown }).results;
    if (Array.isArray(results)) return results as T[];
  }
  return [];
}

/**
 * True while the Inbox is focused and the app is open. Refetches the Inbox on
 * each focus, so coming back from a request shows the current queue at once.
 */
export function useInboxPolling(): boolean {
  const queryClient = useQueryClient();
  return useIsLive(() => void queryClient.invalidateQueries({ queryKey: INBOX_KEY }));
}

/** `GET /orchestrator/hitl/pending/` → `{requests}`. */
export function usePendingRequests(polling: boolean) {
  return useQuery({
    queryKey: PENDING_KEY,
    queryFn: async () => {
      const data = await api<{ requests?: HITLRequest[] }>('/orchestrator/hitl/pending/');
      return data.requests ?? [];
    },
    refetchInterval: polling ? PENDING_POLL_MS : false,
  });
}

/** `GET /notifications/`, newest first as the server sends them. */
export function useNotifications() {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: async () => listOf<InboxNotification>(await api<unknown>('/notifications/')),
  });
}

/** `POST /orchestrator/hitl/{id}/respond/` with `{action, response}`. */
export function useRespond() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: HITLResponseBody }) =>
      api<unknown>(`/orchestrator/hitl/${encodeURIComponent(id)}/respond/`, { method: 'POST', body }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: PENDING_KEY }),
  });
}

/** `POST /notifications/{id}/mark_read/`. Flips the row at once, and puts it back if the server refuses. */
export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<unknown>(`/notifications/${id}/mark_read/`, { method: 'POST', body: {} }),
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_KEY });
      const previous = queryClient.getQueryData<InboxNotification[]>(NOTIFICATIONS_KEY);
      queryClient.setQueryData<InboxNotification[]>(NOTIFICATIONS_KEY, (list) =>
        list?.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(NOTIFICATIONS_KEY, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

/** `POST /notifications/mark_all_read/`. */
export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<unknown>('/notifications/mark_all_read/', { method: 'POST', body: {} }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_KEY });
      const previous = queryClient.getQueryData<InboxNotification[]>(NOTIFICATIONS_KEY);
      queryClient.setQueryData<InboxNotification[]>(NOTIFICATIONS_KEY, (list) =>
        list?.map((n) => ({ ...n, is_read: true })),
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(NOTIFICATIONS_KEY, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}
