/**
 * Orchestrator Service
 *
 * HITL: the pending queue and the response that resumes a run.
 *
 * This used to also carry execution control (execute / status / pause / resume
 * / stop), deploy / undeploy, partial "test step" runs, AI authoring
 * (generate / modify / suggest), thought history and background tasks. Those
 * endpoints were deleted with the workflow canvas that was their only caller,
 * so the methods went with them rather than being left to 404. Agent execution
 * lives in `./agents`. The builder chat transcript (`/orchestrator/chat/`) went
 * the same way on 2026-09-19: its POST stored a message and never answered.
 */

import apiClient from './client';

// HITL types

/**
 * One button on a pending request.
 *
 * The backend writes these as `{label, value}` — the label is what the button
 * says, the value is what the response posts. This was typed `string[]` for as
 * long as the queue existed, which was survivable only because nothing wrote a
 * row: React refuses an object as a child, so the first genuine request took
 * the Inbox detail pane into the error boundary.
 *
 * A bare string is still accepted. Rows written before `open_request` existed
 * carry them, and `options` is a free JSON column that other writers may reach.
 */
export type HITLOption = { label: string; value: string } | string;

export interface HITLRequest {
  request_id: string;
  request_type: 'approval' | 'clarification' | 'error';
  node_id: string;
  title: string;
  message: string;
  options: HITLOption[];
  timeout_seconds: number;
  created_at: string;
  workflow_name?: string;
  /** What the agent is asking to do, rendered by the backend. See `describe_call`. */
  detail?: HITLDetail | null;
  /** An `ask_user` question's shape (kind, options, bounds); see `lib/question`. */
  question?: unknown;
}

/**
 * A tool call as a person reads it, built once on the server so the Inbox,
 * the chat card and a notification all say the same thing.
 */
export interface HITLDetail {
  title: string;
  sentence: string;
  server: string;
  tool: string;
  fields: { label: string; value: string }[];
  raw?: Record<string, unknown>;
}

/** Normalise either stored shape into something renderable. */
export function hitlOption(option: HITLOption): { label: string; value: string } {
  if (typeof option === 'string') {
    return { label: option, value: option.toLowerCase() };
  }
  return {
    label: option?.label ?? String(option?.value ?? ''),
    value: option?.value ?? option?.label ?? '',
  };
}

export interface HITLResponse {
  action: 'approve' | 'reject' | 'respond' | 'retry' | 'skip' | 'stop';
  /** An option label, a number, a list of options or a sentence. */
  response?: string | number | string[];
  data?: Record<string, unknown>;
}

export const orchestratorService = {
  // ========== HITL ==========

  /**
   * Get pending HITL requests
   */
  async getPendingHITL(): Promise<{ requests: HITLRequest[] }> {
    const response = await apiClient.get<{ requests: HITLRequest[] }>('/orchestrator/hitl/pending/');
    return response.data;
  },

  /**
   * Respond to HITL request
   */
  async respondToHITL(requestId: string, response: HITLResponse): Promise<void> {
    await apiClient.post(`/orchestrator/hitl/${requestId}/respond/`, response);
  },
};

export default orchestratorService;
