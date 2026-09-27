/**
 * The card shown when the assistant wants to run a tool that needs your OK.
 *
 * It leads with what is about to happen (a sentence written by the backend in
 * `chat/tools/describe.py`), then the key fields, then the raw arguments
 * behind a closed disclosure. Four answers: approve once, deny, allow for this
 * chat, always allow.
 */
import { Check, ChevronRight, Shield, X } from 'lucide-react';

import type { PendingToolCall } from '../../hooks/useChatStream';

/** How long an approval lasts: this call, this conversation, or for good. */
export type ApprovalScope = 'once' | 'session' | 'always';

/** The manager asking whether one of its agents may act (`answer_subagent`). */
function isWorkerRequest(call: PendingToolCall): boolean {
  return call.tool === 'answer_subagent';
}

interface ToolApprovalCardProps {
  call: PendingToolCall;
  onApprove: (callId: string, scope: ApprovalScope) => void;
  onDeny: (callId: string) => void;
}

export default function ToolApprovalCard({ call, onApprove, onDeny }: ToolApprovalCardProps) {
  return (
    <div className="flex gap-3 md:gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="w-10 h-10 rounded-lg bg-amber-500 flex items-center justify-center shrink-0 border border-border shadow-lg shadow-amber-500/20">
        <Shield className="w-6 h-6 text-white" />
      </div>
      <div className="min-w-0 flex-1 space-y-4 max-w-[92%] md:max-w-[85%]">
        <div className="bg-card/60 p-6 rounded-lg rounded-tl-none shadow-sm border border-border space-y-4">
          {/* The heading is what is about to happen, not the word
              "Permission". A card that leads with the demand and buries the
              act behind raw JSON teaches people to approve without reading,
              which is the one outcome an approval screen must not produce. */}
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-foreground">
              {call.detail?.title ?? 'Permission required'}
            </h3>
            <p className="text-muted-foreground text-sm">
              {call.detail?.sentence
                ?? `The assistant wants to run ${call.tool}.`}
              {' '}Nothing has happened yet.
            </p>
          </div>

          {call.detail?.fields?.length ? (
            <dl className="rounded-lg border border-border/40 overflow-hidden divide-y divide-border/40">
              {call.detail.fields.map((field) => (
                <div key={field.label} className="flex gap-3 px-4 py-2.5 bg-muted/20">
                  <dt className="text-[12px] font-medium text-muted-foreground w-24 shrink-0">
                    {field.label}
                  </dt>
                  {/* Third-party text: rendered as a plain string,
                      never as markdown. */}
                  <dd className="text-[13px] text-foreground min-w-0 break-words">
                    {field.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {/* Kept, and closed. The raw view is what an engineer needs when
              the sentence above is wrong; it is not what the person deciding
              needs to read first. */}
          <details className="group/raw">
            <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors list-none flex items-center gap-1.5">
              <ChevronRight className="w-3 h-3 transition-transform group-open/raw:rotate-90" />
              Show raw arguments
            </summary>
            <div className="mt-2 bg-muted/30 p-3 rounded-lg border border-border/40 space-y-2 overflow-hidden">
              <div className="font-mono text-[11px] text-muted-foreground break-all">
                {call.tool}
              </div>
              <pre className="text-[11px] font-mono text-muted-foreground/80 overflow-x-auto custom-scrollbar">
                {JSON.stringify(call.args, null, 2)}
              </pre>
            </div>
          </details>

          <div className="space-y-2">
            <div className="flex gap-3">
              <button
                onClick={() => onApprove(call.call_id, 'once')}
                className="flex-1 h-11 bg-primary text-primary-foreground font-semibold rounded-lg hover:shadow-lg transition-colors flex items-center justify-center gap-2 group"
              >
                <Check className="w-4 h-4" />
                Approve
              </button>
              <button
                onClick={() => onDeny(call.call_id)}
                className="flex-1 h-11 bg-muted text-muted-foreground font-semibold rounded-lg hover:bg-muted/80 transition-colors flex items-center justify-center gap-2"
              >
                <X className="w-4 h-4" />
                Deny
              </button>
            </div>
            {/* Three answers, quieter as they get longer-lived. The middle
                one is what people actually want: without it, someone who just
                wants to stop being asked for the afternoon says "always" and
                grants a standing allowance over their own mailbox.

                Not for a worker's request (`answer_subagent`): "always allow"
                there would approve every future request from every agent,
                whatever it asks to do. */}
            {!isWorkerRequest(call) && (
            <div className="flex gap-2">
              <button
                onClick={() => onApprove(call.call_id, 'session')}
                className="flex-1 h-9 text-xs font-medium text-muted-foreground rounded-lg border border-border/50 hover:bg-muted/50 hover:text-foreground transition-colors"
              >
                Allow for this chat
              </button>
              <button
                onClick={() => onApprove(call.call_id, 'always')}
                className="flex-1 h-9 text-xs font-medium text-muted-foreground/70 rounded-lg border border-border/40 hover:bg-muted/50 hover:text-foreground transition-colors"
              >
                Always allow
              </button>
            </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
