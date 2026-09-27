/**
 * One modal, two forms — shared by the Schedules page and the agent builder.
 *
 * Which form is decided by `mode`, and the payloads are genuinely different
 * shapes — a schedule PATCHes a cron, a zone, an overlap policy and a window;
 * a webhook PATCHes a name and a goal, because those are the only two fields
 * anything on its path reads. Moved out of `pages/Schedules.tsx` so both
 * places open the same editor: two schedule forms would drift into two
 * schedules that save differently.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import {
  triggersService,
  type Trigger,
  type TriggerMode,
} from '../../api';
import { apiErrorMessage } from '../../lib/apiError';
import ScheduleEditor from './ScheduleEditor';
import WebhookEditor from './WebhookEditor';
import {
  emptyDraft,
  type ScheduleDraft,
} from './scheduleDraft';
import {
  emptyWebhookDraft,
  type WebhookDraft,
} from './webhookDraft';

/** A trigger as the editor's draft, so opening one to edit is not a re-type. */
function draftOf(t: Trigger): ScheduleDraft {
  return {
    cron: t.schedule_cron || t.config?.cron || '',
    timezone: t.timezone || 'UTC',
    name: t.name || '',
    goal: t.goal || '',
    overlap: t.overlap,
    startsAt: t.starts_at,
    endsAt: t.ends_at,
  };
}

/** A webhook trigger as its own editor's draft. */
function webhookDraftOf(t: Trigger): WebhookDraft {
  return { name: t.name || '', goal: t.goal || '' };
}

export default function TriggerModal({
  trigger,
  mode,
  agentId,
  agentAllowsUnattended,
  agentHasPrompt,
  onClose,
}: {
  /** null when creating. */
  trigger: Trigger | null;
  mode: TriggerMode;
  agentId: number;
  agentAllowsUnattended: boolean;
  agentHasPrompt: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isWebhook = mode === 'webhook';
  const [draft, setDraft] = useState<ScheduleDraft>(
    () => (trigger && !isWebhook ? draftOf(trigger) : emptyDraft()),
  );
  const [hook, setHook] = useState<WebhookDraft>(
    () => (trigger && isWebhook ? webhookDraftOf(trigger) : emptyWebhookDraft()),
  );
  const [error, setError] = useState('');
  // The editor's inline "Allow it" grants the permission without leaving the
  // form; this flips the editor's warning off without waiting for the parent
  // to refetch the row (it holds a snapshot, not a subscription).
  const [unattended, setUnattended] = useState(agentAllowsUnattended);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['triggers'] });

  const save = useMutation({
    mutationFn: async () => {
      const payload = isWebhook
        ? { name: hook.name, goal: hook.goal }
        : {
          cron: draft.cron,
          timezone: draft.timezone,
          name: draft.name,
          goal: draft.goal,
          overlap: draft.overlap,
          starts_at: draft.startsAt,
          ends_at: draft.endsAt,
        };
      return trigger
        ? triggersService.update(trigger.id, payload)
        : triggersService.create({ ...payload, subagent: agentId, mode });
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err: unknown) => {
      // The server's own words. Its validation is stricter than the form's —
      // it refuses an expression that never comes round, and a webhook with
      // nothing to ask, neither of which field-level checking here can catch.
      // `apiErrorMessage` knows the DRF field-error shape, so `{"cron": ["..."]}`
      // reads as the sentence rather than the fallback.
      setError(apiErrorMessage(err, 'Could not save this trigger.'));
    },
  });

  // A schedule with no cron cannot be saved; a webhook whose agent is silent
  // needs a goal, which is the server's rule stated before the round trip.
  const incomplete = isWebhook
    ? (!agentHasPrompt && !hook.goal.trim())
    : !draft.cron.trim();

  const title = trigger
    ? (isWebhook ? 'Edit webhook' : 'Edit schedule')
    : (isWebhook ? 'New webhook' : 'New schedule');

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-border/60 bg-card shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4">
          {isWebhook ? (
            <>
              <WebhookEditor
                value={hook}
                onChange={(next) => { setHook(next); setError(''); }}
                agentAllowsUnattended={unattended}
                agentHasPrompt={agentHasPrompt}
              />
              {!trigger && (
                <p className="mt-4 text-[12px] text-muted-foreground">
                  The URL is generated when you save, and shown on the card. It is
                  the only credential &mdash; anyone who has it can start a run.
                </p>
              )}
            </>
          ) : (
            <ScheduleEditor
              value={draft}
              onChange={(next) => { setDraft(next); setError(''); }}
              agentAllowsUnattended={unattended}
              agentId={agentId}
              onUnattendedAllowed={() => { setUnattended(true); invalidate(); }}
            />
          )}
        </div>

        {error && (
          <p className="flex items-start gap-1.5 border-t border-border/60 px-4 py-2 text-[12px] text-destructive">
            <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border/60 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || incomplete}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
          >
            {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {trigger ? 'Save' : (isWebhook ? 'Create webhook' : 'Create schedule')}
          </button>
        </div>
      </div>
    </div>
  );
}
