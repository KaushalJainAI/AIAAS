/**
 * Server-sent-event stream reader.
 *
 * The chat endpoints stream newline-delimited `data: {json}` frames over a
 * plain POST rather than EventSource (EventSource cannot send a body or an
 * Authorization header). Every caller previously inlined the same
 * reader/decoder/buffer loop; the copies had already drifted - one skipped the
 * `response.ok` check, so a 500 surfaced as an empty stream instead of an error.
 */

import { API_URL, tokenManager } from './client';

export interface SseEvent {
  type: string;
  /**
   * `unknown`, not `any`. The wire carries no schema, so every consumer has to
   * narrow - which is the point: `hooks/useChatStream.ts` was concatenating
   * `event.content` straight into the transcript, and a frame that omitted the
   * field appended the literal string "undefined" to the user's answer.
   */
  [key: string]: unknown;
}

export interface StreamRequest {
  /** Path relative to the API root, e.g. `/chat/sessions/1/message/stream/`. */
  path: string;
  body: Record<string, unknown>;
  onEvent: (event: SseEvent) => void;
  signal?: AbortSignal;
  /** Attach the bearer token. Off for guest endpoints, which reject it. */
  authenticated?: boolean;
}

/**
 * A stream the server refused before it started. `code` is the server's
 * machine-readable reason (e.g. `SECURITY_VIOLATION`), so a caller can act on
 * *why* — take a refused message back out of the transcript — rather than
 * matching on the wording of `message`.
 */
export class StreamRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'StreamRequestError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Splits a text chunk into complete `data:` frames, returning the trailing
 * partial line for the next chunk to finish.
 */
function drainFrames(buffer: string, onEvent: (event: SseEvent) => void): string {
  const lines = buffer.split('\n');
  const remainder = lines.pop() ?? '';

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    try {
      onEvent(JSON.parse(line.slice(6)));
    } catch {
      // A malformed frame should not abort a stream that is otherwise fine.
    }
  }
  return remainder;
}

/** POSTs `body` and invokes `onEvent` for each SSE frame until the stream ends. */
export async function streamSse({
  path,
  body,
  onEvent,
  signal,
  authenticated = true,
}: StreamRequest): Promise<void> {
  const token = authenticated ? tokenManager.getAccessToken() : null;

  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    let errorMessage = `Stream request failed: ${response.status}`;
    let errorCode: string | undefined;
    try {
      const text = await response.text();
      for (const line of text.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          if (evt.type === 'error' && typeof evt.message === 'string' && evt.message.trim()) {
            errorMessage = evt.message;
            break;
          }
          if (typeof evt.detail === 'string' && evt.detail.trim()) {
            errorMessage = evt.detail;
            break;
          }
        } catch {
          // ignore malformed frame
        }
      }
      if (errorMessage === `Stream request failed: ${response.status}` && text.trim().startsWith('{')) {
        try {
          const j = JSON.parse(text);
          if (typeof j.code === 'string') errorCode = j.code;
          if (typeof j.detail === 'string' && j.detail.trim()) errorMessage = j.detail;
          else if (typeof j.message === 'string' && j.message.trim()) errorMessage = j.message;
          else if (typeof j.error === 'string' && j.error.trim()) errorMessage = j.error;
        } catch {
          // not JSON
        }
      }
    } catch {
      // Unable to read body - keep generic message.
    }
    throw new StreamRequestError(errorMessage, response.status, errorCode);
  }

  if (!response.body) {
    throw new Error(`Stream request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = drainFrames(buffer, onEvent);
  }

  // A final frame may arrive without its trailing newline.
  drainFrames(`${buffer}\n`, onEvent);
}
