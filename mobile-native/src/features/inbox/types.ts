/**
 * Shapes the Inbox reads from the backend. Copied from the web app
 * (`better-n8n-frontend/src/api/orchestrator.ts`, `src/api/notifications.ts`)
 * and the backend serializer (`Backend/agents/serializers.py::HITLRequestSerializer`).
 */

/** The backend model says `error_recovery`; the web types say `error`. Both render as a failure. */
export type HITLRequestType = 'approval' | 'clarification' | 'error' | 'error_recovery';

/** One button on a pending request: `{label, value}`, or a bare string on rows written before that shape. */
export type HITLOption = { label: string; value: string } | string;

export interface HITLDetailField {
  label: string;
  value: string;
}

/** A tool call as a person reads it, built on the server. */
export interface HITLDetail {
  title: string;
  sentence: string;
  server?: string;
  tool?: string;
  fields: HITLDetailField[];
}

export interface HITLRequest {
  request_id: string;
  request_type: HITLRequestType;
  node_id: string;
  title: string;
  message: string;
  options: HITLOption[];
  timeout_seconds: number | null;
  created_at: string;
  /** The agent that is blocked (the field name is historical). */
  workflow_name?: string | null;
  detail?: HITLDetail | null;
  /** An `ask_user` question: kind, options, bounds. Null on every other row. */
  question?: unknown;
}

/** What a button posts. `respond` carries an answer; the rest are decisions. */
export type HITLAction = 'approve' | 'reject' | 'respond' | 'retry' | 'skip' | 'stop';

/** An answer to a question: an option label, a number, several labels, or a sentence. */
export type HITLAnswer = string | number | string[];

/** Body of `POST /orchestrator/hitl/{id}/respond/`. */
export interface HITLResponseBody {
  action: HITLAction;
  response?: HITLAnswer;
}

/** A row from `GET /notifications/`. The `data` column is routing and is never shown. */
export interface InboxNotification {
  id: number;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  /** Routing for the row. Only `action_url` is read; the rest stays in the record. */
  data?: { action_url?: unknown; [key: string]: unknown } | null;
}
