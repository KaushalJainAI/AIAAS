/** Chat endpoints. Paths are relative to /api (see src/api/client.ts). */
import { api } from '../../api/client';
import { streamSse, type SseEvent } from '../../api/sse';
import { authorizedFetch } from '../files/transfer';
import type { UploadFile } from '../files/upload';
import type {
  ChatSessionDetail,
  ChatSessionSummary,
  CommandCandidate,
  CommandCardData,
  CommandDef,
  Page,
  SteerResult,
} from './types';

export const chatKeys = {
  sessions: ['chat', 'sessions'] as const,
  session: (id: string) => ['chat', 'session', id] as const,
  commands: ['chat', 'commands'] as const,
};

export interface SessionsPage {
  items: ChatSessionSummary[];
  hasNext: boolean;
}

/** One page of the conversation list. The server paginates; a bare array is also accepted. */
export async function fetchSessionsPage(page: number): Promise<SessionsPage> {
  const data = await api<ChatSessionSummary[] | Page<ChatSessionSummary>>('/chat/sessions/', {
    query: { page },
  });
  if (Array.isArray(data)) return { items: data, hasNext: false };
  return { items: data.results, hasNext: Boolean(data.next) };
}

export function fetchSession(id: string): Promise<ChatSessionDetail> {
  return api<ChatSessionDetail>(`/chat/sessions/${id}/`);
}

export function createSession(title: string): Promise<ChatSessionSummary> {
  return api<ChatSessionSummary>('/chat/sessions/', { method: 'POST', body: { title } });
}

export function deleteSession(id: string): Promise<void> {
  return api<void>(`/chat/sessions/${id}/`, { method: 'DELETE' });
}

/**
 * PATCH a session: title, system prompt, memory, model, effort or mode. Sends
 * only the fields given. Answers the updated session without its messages.
 */
export function updateSession(id: string, patch: Partial<ChatSessionDetail>): Promise<ChatSessionSummary> {
  return api<ChatSessionSummary>(`/chat/sessions/${id}/`, { method: 'PATCH', body: patch });
}

/**
 * Removes one message. `rewind` takes the message and everything after it, and
 * the caller puts its text back in the box (the web's "Take back").
 */
export function deleteMessage(sessionId: string, messageId: number, rewind = false): Promise<void> {
  return api<void>(`/chat/sessions/${sessionId}/messages/${messageId}/`, {
    method: 'DELETE',
    query: rewind ? { rewind: 'true' } : undefined,
  });
}

/** Session ids (as strings) with a turn still running for this user. */
export async function activeRunIds(): Promise<string[]> {
  const data = await api<{ active: string[] }>('/chat/runs/');
  return (data.active ?? []).map(String);
}

/** Cancels the running turn. The server saves what streamed so far as a partial answer. */
export function stopTurn(id: string): Promise<unknown> {
  return api<unknown>(`/chat/sessions/${id}/message/stop/`, { method: 'POST' });
}

/**
 * Says something to a running turn. Lands in the run's mailbox and is read at
 * its next tool boundary. Rejects with a 404 when no turn is running.
 */
export function steerTurn(id: string, message: string): Promise<SteerResult> {
  return api<SteerResult>(`/chat/sessions/${id}/message/steer/`, {
    method: 'POST',
    body: { message },
  });
}

/**
 * Switches how much the running turn asks, for the rest of that run. Rides the
 * same mailbox as a steer. 'plan' is refused mid-run (the toolbox is already built).
 */
export function setRunAutonomy(id: string, level: string): Promise<{ autonomy: string }> {
  return api<{ autonomy: string }>(`/chat/sessions/${id}/message/steer/`, {
    method: 'POST',
    body: { autonomy: level },
  });
}

/** POSTs a turn body (a message, an approval, a rejection or an answer) and streams its frames. */
export function sendTurnStream(
  id: string,
  body: Record<string, unknown>,
  onEvent: (event: SseEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  return streamSse({ path: `/chat/sessions/${id}/message/stream/`, body, onEvent, signal });
}

/** Re-attaches to a running turn, replaying frames from index `from`. */
export function attachTurnStream(
  id: string,
  from: number,
  onEvent: (event: SseEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  return streamSse({
    path: `/chat/sessions/${id}/message/attach/`,
    body: { from },
    onEvent,
    signal,
  });
}

/**
 * Uploads one picked file into the chat. The server writes a marker the next
 * turn reads, so "attached" and "the agent can use it" are the same action.
 * Multipart, so it goes through the transfer helper rather than `api()`.
 */
export async function uploadAttachment(sessionId: string, file: UploadFile): Promise<{ message?: string }> {
  const form = new FormData();
  const loose = form as unknown as { append(name: string, value: unknown): void };
  loose.append('file', { uri: file.uri, name: file.name, type: file.type });
  const res = await authorizedFetch(`/chat/sessions/${sessionId}/upload/`, { method: 'POST', body: form });
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as { message?: string }) : {};
  } catch {
    return {};
  }
}

// --- slash commands -----------------------------------------------------------

/** Commands this user can run, filtered the way the tools are. */
export async function fetchCommands(): Promise<CommandDef[]> {
  const data = await api<{ commands?: CommandDef[] }>('/chat/commands/');
  return Array.isArray(data.commands) ? data.commands : [];
}

/** Candidates for one argument: the same predicate the command validates with. */
export async function completeCommandArg(command: string, arg: string, q: string): Promise<CommandCandidate[]> {
  const data = await api<{ candidates?: CommandCandidate[] }>('/chat/commands/complete/', {
    query: { command, arg, q },
  });
  return Array.isArray(data.candidates) ? data.candidates : [];
}

/** Runs an action command server-side and returns its card. No model call. */
export function runCommand(
  name: string,
  args: Record<string, unknown> = {},
  chips: Record<string, string> = {},
  confirm: Record<string, unknown> = {},
): Promise<{ card?: CommandCardData; message?: string }> {
  return api<{ card?: CommandCardData; message?: string }>('/chat/commands/run/', {
    method: 'POST',
    body: { name, args, chips, confirm },
  });
}

/** Carries out a confirm-sheet decision: start a mission, arm a schedule, publish. */
export function confirmCommand(
  name: string,
  args: Record<string, unknown> = {},
  confirm: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return api<Record<string, unknown>>('/chat/commands/confirm/', {
    method: 'POST',
    body: { name, args, confirm },
  });
}

