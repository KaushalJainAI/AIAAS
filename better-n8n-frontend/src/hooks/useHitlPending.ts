/**
 * The one definition of "what is waiting on you", shared by the Sidebar badge
 * and the Activity page.
 *
 * Three components used to declare the same `['hitl','pending']` query with
 * three different intervals, so the effective poll rate was whichever page
 * happened to be mounted. Owning the policy here makes it one number, and lets
 * that number depend on something the individual pages cannot see: whether the
 * per-user HITL socket is live.
 *
 * When the socket is up it already pushes `new_request` and `reminder` frames
 * and invalidates this key (see useHITLReminders), so polling is only a safety
 * net for the transitions nothing pushes — a request answered on another device
 * or in BrowserOS, or one that expired. Every two minutes is enough for that.
 * When the socket is down (no Redis locally, proxy dropped the upgrade, backend
 * restarting) polling is the only channel left, so it tightens to 20s.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { orchestratorService } from '../api/orchestrator';
import type { HITLRequest } from '../api/orchestrator';

/** Socket up: the poll is a backstop for removals nothing broadcasts. */
const LIVE_INTERVAL_MS = 120_000;
/** Socket down: polling is the only way a new request ever appears. */
const FALLBACK_INTERVAL_MS = 20_000;

// Module-level because the publisher (useHITLReminders, mounted once in Layout)
// and the readers (Sidebar, Activity) are siblings, not ancestor and
// descendant. A context would mean wrapping the shell in a provider that exists
// to carry one boolean.
let socketLive = false;
const listeners = new Set<() => void>();

/** Published by useHITLReminders; no other caller should set this. */
export function setHitlSocketLive(live: boolean) {
  if (live === socketLive) return;
  socketLive = live;
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

export function useHitlSocketLive(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => socketLive,
    () => false,
  );
}

/** Mirror a socket hook's connection state into the shared signal. */
export function usePublishHitlSocketLive(isConnected: boolean) {
  useEffect(() => {
    setHitlSocketLive(isConnected);
    return () => setHitlSocketLive(false);
  }, [isConnected]);
}

/**
 * Pending HITL requests. Interval refetch is already paused while the tab is
 * unfocused (react-query's `refetchIntervalInBackground` default) and
 * `refetchOnWindowFocus` covers the gap on return, so a slow live interval
 * costs nothing in freshness.
 */
export function useHitlPending(enabled: boolean = true) {
  const live = useHitlSocketLive();

  return useQuery<HITLRequest[]>({
    queryKey: ['hitl', 'pending'],
    enabled,
    queryFn: async () => (await orchestratorService.getPendingHITL()).requests,
    refetchInterval: live ? LIVE_INTERVAL_MS : FALLBACK_INTERVAL_MS,
  });
}

export default useHitlPending;
