/**
 * Server-sent-event reader for the chat endpoints, which take a POST and stream
 * `data: {json}` frames. Mirrors better-n8n-frontend/src/api/sse.ts.
 *
 * Uses expo/fetch because React Native's global fetch cannot read a streamed body.
 */
import { fetch as expoFetch } from 'expo/fetch';

import { API_URL } from '../config';
import { endSession, refreshAccessToken } from './client';
import { getAccessToken } from './tokens';

export interface SseEvent {
  type: string;
  /** `unknown`, not `any`: the wire has no schema, so every consumer must narrow. */
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
 * A stream the server refused before it started. `code` is the machine-readable
 * reason (e.g. `SECURITY_VIOLATION`) so a caller can act on why, not on wording.
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

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function firstText(...values: unknown[]): string | undefined {
  return values.find((v): v is string => typeof v === 'string' && v.trim() !== '');
}

/** Reads a refused response: one JSON object, or `data:` error frames. */
async function refusalFrom(response: Response): Promise<StreamRequestError> {
  const fallback = `Stream request failed: ${response.status}`;
  const text = await response.text().catch(() => '');
  const candidates = text.trim().startsWith('{')
    ? [text]
    : text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6));

  let message: string | undefined;
  let code: string | undefined;
  for (const raw of candidates) {
    const j = parseObject(raw);
    if (!j) continue;
    message ??= firstText(j.message, j.detail, j.error);
    if (typeof j.code === 'string') code ??= j.code;
    if (message) break;
  }
  return new StreamRequestError(message ?? fallback, response.status, code);
}

/** Dispatches every complete `data:` line and returns the trailing partial line. */
function drainFrames(buffer: string, onEvent: (event: SseEvent) => void): string {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    // Comment lines (":") and anything that is not a data frame are skipped.
    if (!line.startsWith('data: ')) continue;
    let event: SseEvent;
    try {
      event = JSON.parse(line.slice(6)) as SseEvent;
    } catch {
      continue; // a malformed frame must not end an otherwise good stream
    }
    onEvent(event);
  }
  return rest;
}

function open(path: string, body: Record<string, unknown>, token: string | null, signal?: AbortSignal) {
  return expoFetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
}

/** POSTs `body` and calls `onEvent` for each frame until the stream ends. */
export async function streamSse({
  path,
  body,
  onEvent,
  signal,
  authenticated = true,
}: StreamRequest): Promise<void> {
  let response = await open(path, body, authenticated ? getAccessToken() : null, signal);

  // An access token can expire between turns: refresh once rather than fail the turn.
  if (response.status === 401 && authenticated) {
    const fresh = await refreshAccessToken();
    if (fresh) {
      response = await open(path, body, fresh, signal);
    } else {
      await endSession();
    }
  }

  if (!response.ok) throw await refusalFrom(response);
  if (!response.body) throw new StreamRequestError(`Stream request failed: ${response.status}`, response.status);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer = drainFrames(buffer + decoder.decode(value, { stream: true }), onEvent);
  }

  // The last frame may arrive without its trailing newline.
  drainFrames(`${buffer}${decoder.decode()}\n`, onEvent);
}
