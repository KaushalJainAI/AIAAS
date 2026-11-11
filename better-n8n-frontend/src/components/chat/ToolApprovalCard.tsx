/**
 * "Waiting for you": the card shown when the assistant (or one of its agents)
 * wants to run a tool that needs your OK.
 *
 * It leads with what is about to happen (a sentence written by the backend in
 * `chat/tools/describe.py`), then the key fields, then the raw arguments
 * behind a closed disclosure. The footer answers the question: a primary
 * button labelled for the action, a quiet "Decline", and an "Applies to"
 * choice that says how far the yes reaches.
 */
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

import type { PendingToolCall, ToolCallDetail } from '../../hooks/useChatStream';
import { cn } from '../../lib/utils';

/** How long an approval lasts: this call, this conversation, or for good. */
export type ApprovalScope = 'once' | 'session' | 'always';

/**
 * Narrows a session approval to one value of one argument, e.g.
 * `{ to: 'a@b.c' }`. Always a subset of the paused call's arguments.
 */
export type ApprovalMatch = Record<string, string | number>;

/**
 * The optional fields the backend adds to a described call
 * (`chat/tools/describe.py`). Every one may be missing on an older server, and
 * the card draws the same without them.
 */
export interface ApprovalDetail extends ToolCallDetail {
  effect?: 'read' | 'reversible' | 'irreversible';
  leaves_workspace?: boolean;
  first_contact?: boolean;
  action_label?: string;
}

/** The manager asking whether one of its agents may act (`answer_subagent`). */
function isWorkerRequest(call: PendingToolCall): boolean {
  return call.tool === 'answer_subagent';
}

/** Argument names that name who receives the action, in order of preference. */
const RECIPIENT_KEYS = ['to', 'recipient', 'recipients', 'email', 'phone', 'channel', 'chat_id', 'address'];

/** A field label that names the recipient ("To", "Recipient"). */
const RECIPIENT_LABEL = /^(to|recipients?)\b/i;

/** The first recipient-like argument with a plain value, as a session match. */
function recipientMatch(args: Record<string, unknown>): ApprovalMatch | null {
  for (const key of RECIPIENT_KEYS) {
    const value = args[key];
    if (typeof value === 'string' && value.length > 0) return { [key]: value };
    if (typeof value === 'number' && Number.isFinite(value)) return { [key]: value };
  }
  return null;
}

/** "leaves the workspace · can't be undone"-style tag; empty when nothing is known. */
function riskTag(detail: ApprovalDetail): string {
  const parts: string[] = [];
  if (detail.leaves_workspace) parts.push('Leaves the workspace');
  if (detail.effect === 'irreversible') parts.push("can't be undone");
  else if (detail.effect === 'reversible') parts.push('can be undone');
  return parts.join(' · ');
}

/** Worker titles arrive as "Agent · what it wants to do" (describe.py). */
function askerOf(call: PendingToolCall, detail: ApprovalDetail | null): string | null {
  if (!isWorkerRequest(call) || !detail?.title) return null;
  const [name] = detail.title.split(' · ');
  return name && name !== detail.title ? name : null;
}

interface ApplyOption {
  value: string;
  label: string;
  scope: ApprovalScope;
  match?: ApprovalMatch;
}

interface ToolApprovalCardProps {
  call: PendingToolCall;
  /**
   * `scope` is how far the yes reaches. `match` is passed only when the person
   * chose "this recipient, this chat"; with no match the call is exactly
   * `onApprove(callId, scope)`.
   */
  onApprove: (callId: string, scope: ApprovalScope, match?: ApprovalMatch) => void;
  onDeny: (callId: string) => void;
}

export default function ToolApprovalCard({ call, onApprove, onDeny }: ToolApprovalCardProps) {
  const detail = (call.detail ?? null) as ApprovalDetail | null;
  const worker = isWorkerRequest(call);
  const recipient = recipientMatch(call.args ?? {});
  const risk = detail ? riskTag(detail) : '';
  const asker = askerOf(call, detail);
  const fields = detail?.fields ?? [];
  const recipientIndex = fields.findIndex((field) => RECIPIENT_LABEL.test(field.label));

  const options: ApplyOption[] = [
    { value: 'once', label: 'this time only', scope: 'once' },
    { value: 'session', label: 'this chat', scope: 'session' },
  ];
  // Not for a worker's request (`answer_subagent`): "always" there would
  // approve every future request from every agent, whatever it asks to do.
  if (!worker) options.push({ value: 'always', label: 'always', scope: 'always' });
  if (recipient) {
    options.push({ value: 'recipient', label: 'this recipient, this chat', scope: 'session', match: recipient });
  }

  // The choice belongs to one call: a new call starts back at "this time only".
  const [applies, setApplies] = useState<{ callId: string; value: string }>({
    callId: call.call_id,
    value: 'once',
  });
  const chosen = options.find(
    (option) => option.value === (applies.callId === call.call_id ? applies.value : 'once'),
  ) ?? options[0];

  const approve = () => {
    if (chosen.match) {
      onApprove(call.call_id, chosen.scope, chosen.match);
    } else {
      onApprove(call.call_id, chosen.scope);
    }
  };

  return (
    <section
      aria-label="Waiting for your approval"
      className="w-full max-w-3xl overflow-hidden rounded-md border border-warning/40 bg-card animate-in fade-in slide-in-from-bottom-4 duration-500"
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-warning/30 bg-warning-subtle px-3.5 py-2.5">
        <span className="text-sm font-semibold text-warning">Waiting for you</span>
        {asker && <span className="text-sm text-muted-foreground">{asker}</span>}
        {risk && (
          <span className="ml-auto rounded border border-warning/40 bg-background px-2 py-0.5 text-xs font-medium text-warning">
            {risk}
          </span>
        )}
      </div>

      <div className="space-y-3 px-3.5 py-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">
            {detail?.title ?? 'Permission required'}
          </h3>
          <p className="text-[13px] text-muted-foreground">
            {detail?.sentence ?? `The assistant wants to run ${call.tool}.`}
            {' '}Nothing has happened yet.
          </p>
        </div>

        {fields.length > 0 && (
          <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
            {fields.map((field, index) => (
              <div key={`${field.label}-${index}`} className="contents">
                <dt className="text-muted-foreground">{field.label}</dt>
                {/* Third-party text: rendered as a plain string, never as markdown. */}
                <dd className="min-w-0 break-words text-foreground">
                  {field.value}
                  {detail?.first_contact && index === recipientIndex && (
                    <span className="text-muted-foreground"> · first time this agent writes to them</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {detail?.first_contact && recipientIndex < 0 && (
          <p className="text-[12px] text-muted-foreground">First time this agent writes to them.</p>
        )}

        {/* Kept, and closed. The raw view is what an engineer needs when the
            sentence above is wrong; it is not what the person deciding needs
            to read first. */}
        <details className="group/raw">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
            <ChevronRight className="h-3 w-3 transition-transform group-open/raw:rotate-90" />
            Show raw call
          </summary>
          <div className="mt-2 space-y-2 overflow-hidden rounded-md border border-border/40 bg-muted/30 p-3">
            <div className="break-all font-mono text-[11px] text-muted-foreground">{call.tool}</div>
            <pre className="custom-scrollbar overflow-x-auto font-mono text-[11px] text-muted-foreground/80">
              {JSON.stringify(call.args, null, 2)}
            </pre>
          </div>
        </details>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3.5 py-2.5">
        <button
          type="button"
          onClick={approve}
          className="h-9 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {detail?.action_label || 'Approve'}
        </button>
        <button
          type="button"
          onClick={() => onDeny(call.call_id)}
          className="h-9 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Decline
        </button>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          Applies to
          <select
            value={chosen.value}
            onChange={(event) => setApplies({ callId: call.call_id, value: event.target.value })}
            className={cn(
              'h-7 rounded-md border border-border bg-background px-1.5 text-xs text-foreground',
              'focus:outline-none focus:ring-2 focus:ring-primary/40',
            )}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
