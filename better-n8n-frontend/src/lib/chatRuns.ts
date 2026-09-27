/**
 * Chat turns that outlive the component that started them.
 *
 * A streamed answer used to be owned by `StandaloneChat`: the `AbortController`
 * lived in a ref and every consumer of the SSE frames was a closure inside the
 * render. Switching conversations — or navigating to any other page — unmounted
 * that component, and the half-finished answer went with it.
 *
 * A run is therefore held here, outside React, keyed by chat session id. The
 * fetch keeps reading and every frame is buffered, whether or not anything is
 * currently listening. A component that (re)appears subscribes and is replayed
 * the frames it missed, so the live panel rebuilds itself exactly as if it had
 * been mounted the whole time. Only an explicit stop, or a logout, aborts.
 *
 * Frames are replayed, not summarised, because the stream state is a fold over
 * them (`useChatStream`): re-running the fold from the start of the turn is the
 * only reconstruction that cannot drift from the live path.
 */

import { useSyncExternalStore } from 'react';
import { StreamRequestError, type SseEvent } from '../api/sse';

export type RunStatus = 'running' | 'done' | 'error' | 'aborted';

/**
 * Synthetic terminal frame. Emitted to listeners (and to late subscribers,
 * after their replay) so a consumer learns the turn ended without the
 * registry having to re-render every subscriber through React state.
 */
export const RUN_STATUS_EVENT = '__run_status__';

export interface RunStatusEvent {
  type: typeof RUN_STATUS_EVENT;
  status: RunStatus;
  error?: string;
  /** The server's reason code when it refused the request (`SECURITY_VIOLATION`). */
  code?: string;
  /**
   * This is a synthetic frame the client injects into the same stream as the
   * server's, so it has to be assignable to `SseEvent`. Without the index
   * signature the `RunFrame` union does not discriminate — `SseEvent.type` is
   * an open `string`, so TS cannot rule this member out on a `type` check.
   */
  [key: string]: unknown;
}

export type RunFrame = SseEvent | RunStatusEvent;

/** Anything the UI needs to interpret a frame that isn't in the frame itself. */
export interface RunMeta {
  /** Client-side id of the optimistic user message this turn answers. */
  optimisticId?: number;
  intent?: string;
  /**
   * The conversation was created for this message. If the server refuses the
   * message, the conversation is empty and titled after it, so it goes too.
   */
  createdSession?: boolean;
}

type Listener = (frame: RunFrame, replayed: boolean) => void;

export interface ChatRun {
  key: string;
  meta: RunMeta;
  status: RunStatus;
  error?: string;
  errorCode?: string;
  startedAt: number;
  frames: SseEvent[];
}

interface InternalRun extends ChatRun {
  controller: AbortController;
  listeners: Set<Listener>;
  gcTimer: ReturnType<typeof setTimeout> | null;
}

/** How long a finished run stays replayable for a component that returns. */
const RETAIN_FINISHED_MS = 5 * 60 * 1000;

const runs = new Map<string, InternalRun>();

// Store-level subscribers: notified when a run appears or disappears, which is
// what decides whether a component should be subscribed at all. Frame-level
// updates deliberately do not bump this — they go straight to run listeners.
const storeListeners = new Set<() => void>();
let snapshot: string[] = [];

function publish() {
  snapshot = [...runs.values()].filter((r) => r.status === 'running').map((r) => r.key);
  storeListeners.forEach((l) => l());
}

function emit(run: InternalRun, frame: RunFrame) {
  run.listeners.forEach((listener) => {
    try {
      listener(frame, false);
    } catch (err) {
      // One broken consumer must not stop the others, or the stream.
      console.error('chat run listener failed', err);
    }
  });
}

function scheduleGc(run: InternalRun) {
  if (run.gcTimer) clearTimeout(run.gcTimer);
  run.gcTimer = setTimeout(() => {
    // Keep it if something is still watching; it will be collected when the
    // last listener leaves and the timer is re-armed.
    if (run.listeners.size > 0) {
      scheduleGc(run);
      return;
    }
    runs.delete(run.key);
    publish();
  }, RETAIN_FINISHED_MS);
}

function finish(run: InternalRun, status: RunStatus, error?: string, code?: string) {
  if (run.status !== 'running') return;
  run.status = status;
  run.error = error;
  run.errorCode = code;
  emit(run, { type: RUN_STATUS_EVENT, status, error, code });
  scheduleGc(run);
  publish();
}

/**
 * Starts a turn for `key` and returns it. A key that is already running is
 * returned untouched — the caller's guard on `isLoading` should prevent this,
 * but two concurrent streams on one session would interleave frames into a
 * single transcript, so it is refused here as well.
 */
export function startChatRun(
  key: string,
  runner: (onEvent: (event: SseEvent) => void, signal: AbortSignal) => Promise<void>,
  meta: RunMeta = {},
): ChatRun {
  const existing = runs.get(key);
  if (existing && existing.status === 'running') return existing;

  if (existing?.gcTimer) clearTimeout(existing.gcTimer);

  const run: InternalRun = {
    key,
    meta,
    status: 'running',
    startedAt: Date.now(),
    frames: [],
    controller: new AbortController(),
    listeners: new Set(),
    gcTimer: null,
  };
  runs.set(key, run);
  publish();

  runner(
    (event) => {
      run.frames.push(event);
      emit(run, event);
    },
    run.controller.signal,
  ).then(
    () => finish(run, 'done'),
    (err: unknown) => {
      if ((err as Error)?.name === 'AbortError') {
        finish(run, 'aborted');
        return;
      }
      finish(
        run,
        'error',
        err instanceof Error ? err.message : 'Failed to get response',
        err instanceof StreamRequestError ? err.code : undefined,
      );
    },
  );

  return run;
}

export function getChatRun(key: string | undefined): ChatRun | undefined {
  return key ? runs.get(key) : undefined;
}

/**
 * Replays every frame buffered so far, then delivers live ones. The `replayed`
 * flag lets a consumer skip side effects it has already performed (toasts,
 * transcript appends) while still folding the frame into its view state.
 */
export function subscribeChatRun(key: string, listener: Listener): () => void {
  const run = runs.get(key);
  if (!run) return () => {};

  for (const frame of run.frames) listener(frame, true);
  if (run.status !== 'running') {
    listener(
      { type: RUN_STATUS_EVENT, status: run.status, error: run.error, code: run.errorCode },
      true,
    );
  }

  run.listeners.add(listener);
  return () => {
    run.listeners.delete(listener);
  };
}

/** Stops a turn. The buffered frames stay, so the partial answer is not lost. */
export function abortChatRun(key: string | undefined) {
  const run = key ? runs.get(key) : undefined;
  if (!run || run.status !== 'running') return;
  run.controller.abort();
  finish(run, 'aborted');
}

/** Aborts everything — used on logout, where the token is about to be gone. */
export function abortAllChatRuns() {
  for (const key of [...runs.keys()]) abortChatRun(key);
}

function subscribeStore(listener: () => void) {
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
}

/**
 * Session ids currently streaming. Drives the "still working" marker in the
 * conversation list, which is the only cue that a backgrounded turn is alive.
 */
export function useRunningChatKeys(): string[] {
  return useSyncExternalStore(subscribeStore, () => snapshot, () => snapshot);
}
