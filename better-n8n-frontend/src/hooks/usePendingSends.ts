/**
 * Messages the agent is holding before they go out (the send window,
 * `Backend/docs/UNDO_PLAN.md` §5). One hook serves the chat and a run's page:
 * it lists the holds for one chat session and/or one run, and lets the person
 * cancel or send one now.
 *
 * It polls every two seconds, and only while a row is `held` or `sending`.
 * When nothing is pending it stops, so an idle page makes no requests. A
 * `nudge` counter, bumped when a send tool shows up in the live turn, re-reads
 * the list at once and once more two seconds later, because the trace frame
 * arrives a moment before the hold row is written.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  messagingService,
  type HoldActionResult,
  type HoldRow,
  type HoldStatus,
} from '@/api/messaging';

/** How often a pending list is re-read. */
export const POLL_MS = 2000;
/** The second read after a nudge, for the row that is not written yet. */
export const NUDGE_FOLLOWUP_MS = 2000;

/** The tools whose sends the server can hold (`message_send`, `gmail_send_message`). */
export const HELD_SEND_TOOLS: ReadonlySet<string> = new Set([
  'message_send',
  'gmail_send_message',
]);

const TERMINAL: ReadonlySet<HoldStatus> = new Set(['sent', 'cancelled', 'failed', 'unknown']);

/** Whether a hold still needs watching. */
export function isPendingHold(status: HoldStatus): boolean {
  return status === 'held' || status === 'sending';
}

export interface TrackedHold extends HoldRow {
  /** `Date.now()` when this status was read here; `seconds_left` counts from it. */
  fetchedAt: number;
  /** When the row first showed a finished status here. Drives the 2-minute outcome line. */
  settledAt?: number;
}

export interface PendingSendsScope {
  sessionId?: string;
  executionId?: string;
  /** Bump to re-read the list (a send tool was seen in the live turn). */
  nudge?: number;
}

interface Tracked {
  scope: string;
  holds: TrackedHold[];
}

const NONE: TrackedHold[] = [];

/** The server's rows, with the client's clock and the first-seen finish time kept. */
function mergeRows(prev: TrackedHold[], rows: HoldRow[], now: number): TrackedHold[] {
  const settledBefore = new Map(prev.map((h) => [h.id, h.settledAt]));
  return rows.map((row) => ({
    ...row,
    fetchedAt: now,
    settledAt: TERMINAL.has(row.status) ? (settledBefore.get(row.id) ?? now) : undefined,
  }));
}

export function usePendingSends({ sessionId, executionId, nudge = 0 }: PendingSendsScope) {
  const scope = `${sessionId ?? ''}|${executionId ?? ''}`;
  const enabled = Boolean(sessionId || executionId);

  // Holds are kept with the scope they belong to, so a chat switch never shows
  // the previous chat's rows, even for the one render before the new list lands.
  const [tracked, setTracked] = useState<Tracked>({ scope, holds: NONE });
  const holds = enabled && tracked.scope === scope ? tracked.holds : NONE;

  const alive = useRef(true);
  const latest = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback((): Promise<void> => {
    if (!enabled) return Promise.resolve();
    const mine = ++latest.current;
    return messagingService
      .listHolds({ sessionId, executionId })
      .then(({ holds: rows }) => {
        // A slower, older read must not overwrite a newer one.
        if (!alive.current || mine !== latest.current) return;
        const now = Date.now();
        setTracked((prev) => ({
          scope,
          holds: mergeRows(prev.scope === scope ? prev.holds : NONE, rows, now),
        }));
      })
      // Keep what is on screen; the next poll or nudge tries again.
      .catch(() => undefined);
  }, [enabled, sessionId, executionId, scope]);

  // Read now, and again after a nudge (see the file comment).
  useEffect(() => {
    void refresh();
    if (nudge === 0) return undefined;
    const followUp = window.setTimeout(() => {
      void refresh();
    }, NUDGE_FOLLOWUP_MS);
    return () => window.clearTimeout(followUp);
  }, [refresh, nudge]);

  // Poll only while something is still going out.
  const pending = holds.some((h) => isPendingHold(h.status));
  useEffect(() => {
    if (!enabled || !pending) return undefined;
    const timer = window.setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, pending, refresh]);

  const applyResult = useCallback((id: number, result: HoldActionResult) => {
    const now = Date.now();
    setTracked((prev) => {
      if (prev.scope !== scope) return prev;
      return {
        scope,
        holds: prev.holds.map((h) => (h.id !== id ? h : {
          ...h,
          status: result.status,
          fetchedAt: now,
          settledAt: TERMINAL.has(result.status) ? (h.settledAt ?? now) : undefined,
        })),
      };
    });
  }, [scope]);

  const act = useCallback(async (
    id: number,
    call: (hold: number) => Promise<HoldActionResult>,
    failure: string,
  ) => {
    try {
      const result = await call(id);
      if (alive.current) applyResult(id, result);
    } catch {
      toast.error(failure);
    }
    void refresh();
  }, [applyResult, refresh]);

  const cancel = useCallback(
    (id: number) => act(id, (hold) => messagingService.cancelHold(hold),
      "Couldn't cancel that message. Try again."),
    [act],
  );

  const sendNow = useCallback(
    (id: number) => act(id, (hold) => messagingService.sendHoldNow(hold),
      "Couldn't send that message now. Try again."),
    [act],
  );

  return { holds, cancel, sendNow };
}

export default usePendingSends;
