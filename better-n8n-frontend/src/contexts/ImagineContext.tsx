import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { imagineApi, type Generation } from '../api/imagine';
import { useSocket } from '../lib/websocket';
import { useAuth } from './authState';

import { ImagineContext, type ImagineContextValue } from './imagineState';

const FALLBACK_POLL_MS = 15000;

// Tracks ids we already toasted for completion to avoid double-notify
function useNotifiedSet() {
  const ref = useRef<Set<number>>(new Set());
  const has = useCallback((id: number) => ref.current.has(id), []);
  const add = useCallback((id: number) => ref.current.add(id), []);
  return { has, add };
}

export function ImagineProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [active, setActive] = useState<Generation[]>([]);
  const { has, add } = useNotifiedSet();

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setActive([]);
      return;
    }
    try {
      const all = await imagineApi.list();
      const pending = all.filter(
        (g) => g.status === 'pending' || g.status === 'processing',
      );
      setActive(pending);
    } catch {
      // silent — catalog may be empty or offline
    }
  }, [isAuthenticated]);

  // Fetch on mount, and clear the cache when the user signs out. Suppressed
  // rather than restructured: `refresh` reads the server and, in its
  // signed-out branch, drops locally cached server data — both are
  // synchronisation with something outside React, not state that could have
  // been derived during render. The rule cannot see past the `refresh`
  // indirection to tell the two apart.
  useEffect(() => {
    // See the note above: a server read, plus dropping cached server data on
    // sign-out. Both are synchronisation with something outside React.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const handleMessage = useCallback(
    (msg: { type?: string; data?: { generation_id?: number; status?: string; output_url?: string | null; error?: string | null } }) => {
      const type = (msg as { type?: string }).type;
      const data = (msg as { data?: Record<string, unknown> }).data ?? {};

      // We fetch the full generation to get prompt/file details for toast + accurate state.
      // For started we just refresh active list; for terminal we remove + notify.
      if (type === 'generation.started') {
        // New pending job appeared — re-query active so tracker shows it even if user is off-page.
        void refresh();
        // Don't toast "started" — the originating page already did. Global toast is for completion.
        return;
      }

      if (type === 'generation.completed' || type === 'generation.failed') {
        const id = data.generation_id as number | undefined;
        if (typeof id !== 'number') {
          void refresh();
          return;
        }
        if (has(id)) {
          // Already handled — just ensure it's removed from active
          setActive((prev) => prev.filter((g) => g.id !== id));
          return;
        }
        // Fetch the terminal row to decide toast copy. If fetch fails, fall back to event data.
        imagineApi
          .get(id)
          .then((g) => {
            setActive((prev) => prev.filter((p) => p.id !== g.id));
            if (has(g.id)) return;
            add(g.id);
            // Suppress global toast when user is currently on the imagine page —
            // the local bubble/result card already surfaces the outcome.
            const onImagine = window.location.pathname.startsWith('/imagine');
            if (onImagine) return;
            if (g.status === 'completed') {
              toast.success(`${g.type === 'image' ? 'Image' : g.type === 'video' ? 'Video' : 'Audio'} ready`, {
                description: g.prompt.slice(0, 80),
                action: {
                  label: 'View',
                  onClick: () => window.location.assign('/imagine'),
                },
                duration: 6000,
              });
            } else {
              toast.error(`${g.type} generation failed`, {
                description: (g.error_message ?? (data.error as string | undefined) ?? 'Generation failed').slice(
                  0,
                  120,
                ),
                duration: 6000,
              });
            }
          })
          .catch(() => {
            // Fetch failed — still remove from active and notify from event payload
            setActive((prev) => prev.filter((p) => p.id !== id));
            if (has(id)) return;
            add(id);
            const onImagine = window.location.pathname.startsWith('/imagine');
            if (onImagine) return;
            if (type === 'generation.completed') {
              toast.success('Generation ready', {
                description: 'Open Studio to view it.',
                action: { label: 'View', onClick: () => window.location.assign('/imagine') },
              });
            } else {
              toast.error('Generation failed', {
                description: ((data.error as string | undefined) ?? 'Generation failed').slice(0, 120),
              });
            }
          });
        return;
      }

      if (type === 'generation.progress') {
        // No UI change, but ensures active list is fresh
        void refresh();
      }
    },
    [refresh, has, add],
  );

  const { isConnected } = useSocket({
    path: '/imagine-agent/',
    enabled: isAuthenticated,
    onMessage: handleMessage,
  });

  // Fallback poll when socket is down but there are active jobs
  useEffect(() => {
    if (!isAuthenticated || isConnected || active.length === 0) return;
    const timer = setInterval(() => void refresh(), FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [isAuthenticated, isConnected, active.length, refresh]);

  const value = useMemo<ImagineContextValue>(
    () => ({
      active,
      activeCount: active.length,
      isGenerating: active.length > 0,
      refresh,
    }),
    [active, refresh],
  );

  return <ImagineContext.Provider value={value}>{children}</ImagineContext.Provider>;
}

