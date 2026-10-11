/**
 * Follows one chat turn to its real end, across dropped connections.
 *
 * The server owns a turn: it keeps working when the response watching it goes
 * away (`Backend/chat/turn/runs.py`). The client did not match that. A stream
 * that closed for any reason — a proxy's idle timeout during a long tool call,
 * a network blip, a laptop waking up — was read as "the turn finished", so the
 * spinner stopped and the user saw no answer while the agent was still
 * working, with a page reload the only way back to it.
 *
 * Every turn ends with a `done` or an `error` frame. A stream that closes
 * without one was cut, not finished, so this re-attaches from the frame it had
 * reached and carries on, until the server says the turn is over.
 *
 * Transport is injected so the loop is testable without a network.
 */

import type { SseEvent } from '../api/sse';

type OnEvent = (event: SseEvent) => void;

export interface FollowTurnOptions {
  /** Opens the turn: the POST that sends the message (or the first attach). */
  open: (onEvent: OnEvent) => Promise<void>;
  /** Re-attaches to the running turn, replaying from frame `fromIndex`. */
  attach: (onEvent: OnEvent, fromIndex: number) => Promise<void>;
  /** Whether the server still has this turn running. */
  isRunning: () => Promise<boolean>;
  onEvent: OnEvent;
  signal?: AbortSignal;
  /** Frames the caller already holds, when `open` itself is an attach. */
  fromIndex?: number;
  /** Replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** Waits between reconnects: 1s, 2s, 4s, then every 5s. */
export function reconnectDelay(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(attempt, 0), 5000);
}

/**
 * How many reconnects in a row may fail outright before giving up. With the
 * delays above that is about half a minute, which covers a deploy restart.
 */
export const MAX_FAILED_RECONNECTS = 8;

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (err as Error | undefined)?.name === 'AbortError';
}

/** A response the server answered with a refusal, as `api/sse.ts` throws it. */
function isRefusal(err: unknown): boolean {
  return typeof (err as { status?: unknown } | undefined)?.status === 'number';
}

export async function followTurn({
  open,
  attach,
  isRunning,
  onEvent,
  signal,
  fromIndex = 0,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: FollowTurnOptions): Promise<void> {
  // The server's index of the next frame this client needs. Keep-alive
  // comments are not frames and never reach here, so the count stays aligned.
  let seen = fromIndex;
  let ended = false;
  const forward: OnEvent = (event) => {
    seen += 1;
    if (event.type === 'done' || event.type === 'error') ended = true;
    onEvent(event);
  };

  let failure: unknown;
  try {
    await open(forward);
  } catch (err) {
    // A refusal is the server's answer (400 from the sanitizer, 401, 413):
    // nothing is running, and the caller shows what it said.
    if (isAbort(err, signal) || isRefusal(err)) throw err;
    failure = err;
  }

  let failed = 0;
  let tailRead = false;
  while (!ended) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    let running: boolean;
    try {
      running = await isRunning();
    } catch (err) {
      if (isAbort(err, signal)) throw err;
      failure = failure ?? err;
      failed += 1;
      if (failed > MAX_FAILED_RECONNECTS) throw failure;
      await sleep(reconnectDelay(failed - 1));
      continue;
    }

    // Not running: either it finished while we were cut off, in which case one
    // last attach replays the frames we missed (the answer among them), or the
    // message never reached the server at all.
    if (!running && tailRead) {
      if (failure !== undefined && seen === fromIndex) throw failure;
      return;
    }
    if (!running) tailRead = true;

    const before = seen;
    try {
      await attach(forward, seen);
      failed = 0;
    } catch (err) {
      if (isAbort(err, signal)) throw err;
      failure = failure ?? err;
      failed += 1;
      if (failed > MAX_FAILED_RECONNECTS) throw failure;
    }
    if (ended) return;
    // A reconnect that brought nothing must not spin: back off before asking
    // again. One that made progress reconnects straight away.
    if (running && seen === before) await sleep(reconnectDelay(failed));
  }
}
