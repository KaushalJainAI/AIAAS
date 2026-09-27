/**
 * The webhook configurator — a short form, and that is the point.
 *
 * A webhook trigger carries two editable things: a name for the person who has
 * to recognise it in a list, and the instruction the agent runs when a request
 * arrives. Everything else a schedule offers is absent because the receiver
 * does not read it: `webhook_receive` calls `start_agent_run` directly, so it
 * never sees `overlap`, `timezone`, `starts_at` or `ends_at`, and the sweep
 * that does read them never sees this row.
 *
 * The two warnings are the whole safety story of this screen:
 *
 * - **The body is context, never the goal.** An inbound request that could set
 *   the instruction would be prompt injection from a URL that by design has no
 *   authentication behind it. The form says so where the goal is typed, so
 *   nobody writes "do whatever the payload says".
 * - **The agent must be cleared for unattended runs.** Same gate the runtime
 *   enforces in `_check_unattended`; without it every request is refused and
 *   the only evidence is a trigger that switches itself off after five.
 */
import { AlertTriangle, Info } from 'lucide-react';

import type { WebhookDraft } from './webhookDraft';

const inputCls =
  'w-full h-9 px-3 rounded-lg border border-input bg-background text-sm ' +
  'focus:outline-none focus:ring-1 focus:ring-primary';

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">
        {label}
        {hint && <span className="ml-1.5 font-normal opacity-70">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

export default function WebhookEditor({
  value,
  onChange,
  agentAllowsUnattended = true,
  agentHasPrompt = true,
}: {
  value: WebhookDraft;
  onChange: (next: WebhookDraft) => void;
  /** Same gate the runtime enforces; saying it here saves five silent refusals. */
  agentAllowsUnattended?: boolean;
  /**
   * Whether the agent itself carries a description. The server refuses a hook
   * with neither a goal nor an agent prompt, because the receiver's own 404 for
   * that case is deliberately indistinguishable from a wrong secret — so the
   * hook would be dead with nothing to look at.
   */
  agentHasPrompt?: boolean;
}) {
  const set = (patch: Partial<WebhookDraft>) => onChange({ ...value, ...patch });
  const needsGoal = !agentHasPrompt && !value.goal.trim();

  return (
    <div className="space-y-4">
      {!agentAllowsUnattended && (
        <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <p className="text-[12px] text-warning">
            This agent isn&rsquo;t allowed to run with nobody watching, so every
            request to this URL will be refused. Turn on &ldquo;may run with
            nobody watching&rdquo; on the agent first.
          </p>
        </div>
      )}

      <Field label="Name" hint="what you'll recognise it by">
        <input
          className={inputCls}
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Production alerts"
          maxLength={80}
        />
      </Field>

      <Field label="What should the agent do?" hint="sent on every request">
        <textarea
          className={`${inputCls} h-auto py-2 min-h-[80px] resize-y`}
          value={value.goal}
          onChange={(e) => set({ goal: e.target.value })}
          placeholder="Triage the incoming alert and post a summary to the on-call channel."
        />
      </Field>

      <div className="flex gap-2 rounded-lg border border-border/60 bg-secondary/40 px-3 py-2">
        <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-[12px] text-muted-foreground">
          The request body is added to this instruction as <em>context</em>, never
          as the instruction itself &mdash; anyone who knows the URL can send a
          body, so a request can never tell the agent what to do. Bodies over
          64&nbsp;KB are refused.
        </p>
      </div>

      {needsGoal && (
        <p className="flex items-start gap-1.5 text-[12px] text-warning">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
          This agent has no description of its own, so this hook needs an
          instruction &mdash; without one every request is refused.
        </p>
      )}
    </div>
  );
}
