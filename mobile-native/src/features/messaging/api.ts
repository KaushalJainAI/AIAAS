/**
 * The send window on the phone: messages the agent is holding before they go
 * out (`Backend/docs/UNDO_PLAN.md` §5). Same routes and request shapes as the
 * web's `better-n8n-frontend/src/api/messaging.ts`, which is the reference.
 *
 * Paths are relative to /api (see src/api/client.ts).
 */
import { ApiError, api } from '../../api/client';
import type { SseEvent } from '../../api/sse';

/** A held send's state. `held` can still be cancelled; `sending` cannot. */
export type HoldStatus = 'held' | 'sending' | 'sent' | 'cancelled' | 'failed' | 'unknown';

/** One row of `GET /api/messaging/holds/` (`messaging/views.py::_hold_row`). */
export interface HoldRow {
  id: number;
  tool: string;
  label: string;
  status: HoldStatus;
  send_at: string;
  error: string;
  seconds_left: number;
}

export interface HoldList {
  holds: HoldRow[];
  truncated: boolean;
}

/** Cancel and send-now answer with the hold's status; 409 means it was too late. */
export interface HoldActionResult {
  status: HoldStatus;
}

/** The tools whose sends the server can hold (`message_send`, `gmail_send_message`). */
export const HELD_SEND_TOOLS: ReadonlySet<string> = new Set(['message_send', 'gmail_send_message']);

/** Whether a hold still needs watching. */
export function isPendingHold(status: HoldStatus): boolean {
  return status === 'held' || status === 'sending';
}

/**
 * Whether a live frame is a call to one of the send tools. The turn screen uses
 * it to re-read the bar, because the hold row is written a moment after the frame.
 */
export function isSendToolTrace(event: SseEvent): boolean {
  return event.type === 'agent_trace' && event.sub_type === 'tool' && typeof event.tool === 'string'
    && HELD_SEND_TOOLS.has(event.tool);
}

/** The caller's waiting sends, for one chat session and/or one run. */
export function listHolds(scope: { sessionId?: string; executionId?: string }): Promise<HoldList> {
  const query: Record<string, string> = {};
  if (scope.sessionId) query.session = scope.sessionId;
  if (scope.executionId) query.execution = scope.executionId;
  return api<HoldList>('/messaging/holds/', { query });
}

function isActionResult(body: unknown): body is HoldActionResult {
  return typeof body === 'object' && body !== null && typeof (body as { status?: unknown }).status === 'string';
}

/** POSTs a hold action. 409 (too late: it is sending or already done) is an answer, so it comes back as the current status. */
function holdAction(id: number, action: 'cancel' | 'send-now'): Promise<HoldActionResult> {
  return api<HoldActionResult>(`/messaging/holds/${id}/${action}/`, { method: 'POST' }).catch((err: unknown) => {
    if (err instanceof ApiError && err.status === 409 && isActionResult(err.body)) return err.body;
    throw err;
  });
}

/** Cancel a held send. Answers with the hold's status; a send already out comes back as its current status. */
export function cancelHold(id: number): Promise<HoldActionResult> {
  return holdAction(id, 'cancel');
}

/** Send a held message now. A hold that is no longer `held` comes back as its current status. */
export function sendHoldNow(id: number): Promise<HoldActionResult> {
  return holdAction(id, 'send-now');
}
