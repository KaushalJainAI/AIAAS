/**
 * "Save this fix for your team?" under an answer that was drafted into the
 * organisation's library (`metadata.solution_draft`, written by
 * `solutions/capture.py::_mark_draft`).
 *
 * It only draws. The three choices are callbacks; the parent makes the call
 * and, once it has an outcome, writes it back onto the message. The card then
 * stays in its resolved state, so reopening the chat shows what was done.
 *
 * When the outcome arrives while the card is on screen, the choices fade out
 * and the outcome fades in over the same cell, so the card does not jump.
 * A card that opens already resolved shows only the outcome.
 */
import { Check, Loader2 } from 'lucide-react';

import { usePresence } from '../../hooks/usePresence';
import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';

export type DraftAction = 'share' | 'private' | 'discard';

/** The `resolved` values `solutions/api.py::_resolve_card` writes. */
export type DraftResolved = 'shared' | 'waiting_review' | 'kept_private' | 'discarded' | 'returned';

export interface SolutionDraftInfo {
  id: number;
  problem: string;
  share_requested?: boolean;
  org_name?: string | null;
  resolved?: DraftResolved | null;
}

const DRAFT_OUTCOME_TEXT: Record<DraftResolved, string> = {
  shared: 'Shared',
  waiting_review: 'Waiting for a curator',
  kept_private: 'Kept private',
  discarded: 'Discarded',
  returned: 'Sent back by a curator',
};

/** The choices fade out in the accelerate exit, ~30% shorter than the 150ms fade in. */
const CHOICES_EXIT_MS = 100;

export interface SolutionDraftCardProps {
  draft: SolutionDraftInfo;
  /** A choice for this draft is being sent. */
  busy?: boolean;
  onAction: (action: DraftAction) => void;
}

export default function SolutionDraftCard({ draft, busy = false, onAction }: SolutionDraftCardProps) {
  const resolved = draft.resolved ? DRAFT_OUTCOME_TEXT[draft.resolved] ?? null : null;
  const choices = usePresence(!resolved, CHOICES_EXIT_MS);
  const leaving = choices.state === 'exit';

  return (
    <section
      aria-label="Save this fix for your team?"
      className="rounded-lg border border-border/70 bg-card/60 p-3 text-sm"
    >
      <p className="font-medium">Save this fix for your team?</p>
      <p className="mt-0.5 text-[13px] text-muted-foreground break-words">{draft.problem}</p>

      {/* One grid cell holds both states, so the cross-fade happens in place. */}
      <div className="mt-2 grid">
        {choices.present && (
          <div
            inert={leaving}
            className={cn(
              'col-start-1 row-start-1 flex flex-wrap items-center gap-2',
              leaving ? 'animate-fade-out pointer-events-none' : 'animate-fade-in',
            )}
          >
            {draft.org_name && (
              <Button
                size="sm"
                variant={draft.share_requested ? 'primary' : 'secondary'}
                disabled={busy}
                onClick={() => onAction('share')}
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                Share with {draft.org_name}
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAction('private')}>
              Keep private
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAction('discard')}>
              Discard
            </Button>
            <a
              href={`/solutions?id=${draft.id}`}
              className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Edit first
            </a>
          </div>
        )}

        {resolved && (
          <p
            role="status"
            className="col-start-1 row-start-1 flex min-h-[32px] items-center gap-1.5 text-[13px] text-foreground animate-fade-in"
          >
            <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
            {resolved}
          </p>
        )}
      </div>
    </section>
  );
}
