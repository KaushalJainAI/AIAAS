/**
 * Follows one chat turn to its real end, across dropped connections.
 *
 * Port of better-n8n-frontend/src/lib/followTurn.ts. The server owns a turn and
 * keeps it running when the response watching it goes away. Every turn ends
 * with a `done` or `error` frame; a stream that closes without one was cut, so
 * this re-attaches from the frame it reached, until the server says the turn is
 * over. Transport is injected so the loop can be read and tested on its own.
 */
import type { SseEvent } from '../../api/sse';

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
  sleep?: (ms: number) => Promise<void>;
}

/** Waits between reconnects: 1s, 2s, 4s, then every 5s. */
export function reconnectDelay(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(attempt, 0), 5000);
}

/** Reconnects in a row that may fail outright before giving up (about half a minute). */
export const MAX_FAILED_RECONNECTS = 8;

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (err as Error | undefined)?.name === 'AbortError';
}

/** A refusal the server answered with (ApiError / StreamRequestError carry a numeric status). */
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
  // The index of the next frame this client needs. Keep-alive comments are not
  // frames and never reach here, so the count stays aligned with the server.
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
    // A refusal is the server's answer (400, 401, 413): nothing is running.
    if (isAbort(err, signal) || isRefusal(err)) throw err;
    failure = err;
  }

  let failed = 0;
  let tailRead = false;
  while (!ended) {
    if (signal?.aborted) throw abortError();

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

    // Not running: it finished while we were cut off, so one last attach replays
    // the frames we missed. After that, stop.
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
    // A reconnect that brought nothing must not spin: back off before asking again.
    if (running && seen === before) await sleep(reconnectDelay(failed));
  }
}
