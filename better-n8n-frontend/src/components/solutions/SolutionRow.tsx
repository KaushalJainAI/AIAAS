/**
 * One row of the library, drafts or queue list. The row opens the solution in
 * the detail pane. In the "Needs attention" view it also offers the three
 * things that clear an attention flag: Still true, Edit and Retract.
 *
 * Two motions. A row being removed (`leaving`, set optimistically by the write
 * that removes it) collapses its height and fades before it leaves the DOM. A
 * row whose content changed since it was first shown flashes once.
 */
import { useState } from 'react';
import { CheckCircle2, Pencil, Trash2 } from 'lucide-react';

import type { Solution } from '../../api/solutions';
import { usePresence } from '../../hooks/usePresence';
import { attentionLabel } from '../../lib/solutionsPage';
import { cn } from '../../lib/utils';
import { Badges } from './SolutionParts';

/** The collapse-out time. Exits run ~30% shorter than the entrance they undo. */
const ROW_EXIT_MS = 150;

export interface SolutionRowProps {
  s: Solution;
  selected: boolean;
  /** The row is in the "Needs attention" view: show its reasons and actions. */
  attentionView: boolean;
  /** A write is removing this row; it collapses out instead of vanishing. */
  leaving?: boolean;
  busy: boolean;
  onOpen: (id: number) => void;
  onTag: (tag: string) => void;
  onStillTrue: (s: Solution) => void;
  onEdit: (s: Solution) => void;
  onRetract: (s: Solution) => void;
}

export default function SolutionRow({
  s,
  selected,
  attentionView,
  leaving = false,
  busy,
  onOpen,
  onTag,
  onStillTrue,
  onEdit,
  onRetract,
}: SolutionRowProps) {
  const [confirming, setConfirming] = useState(false);
  // The version this row was first shown with. A later version means it changed.
  const [firstSeen] = useState(s.updated_at);
  const presence = usePresence(!leaving, ROW_EXIT_MS);
  if (!presence.present) return null;

  const exiting = presence.state === 'exit';
  const changed = s.updated_at !== firstSeen;
  const reasons = s.attention ?? [];
  const tags = s.tags ?? [];

  return (
    <li
      inert={exiting}
      className={cn(
        'grid transition-[grid-template-rows] duration-normal ease-accelerate',
        exiting ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
      )}
    >
      <div className="min-h-0 overflow-hidden">
        {/* Keyed on the version: a new version remounts the box, which replays the flash once. */}
        <div
          key={changed ? String(s.updated_at) : 'steady'}
          className={cn(
            'min-w-0 rounded-md border p-3 transition-[opacity] duration-normal ease-accelerate',
            selected ? 'border-primary/50 bg-primary/5' : 'border-border/60 bg-card/60',
            exiting && 'opacity-0',
            changed && !exiting && 'animate-flash',
          )}
        >
          <button
            type="button"
            onClick={() => onOpen(s.id)}
            aria-current={selected ? 'true' : undefined}
            className="block w-full min-w-0 text-left"
          >
            <p className="break-words text-sm font-medium">{s.problem}</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {s.solved_by} · {s.solved_on} · worked for {s.track_record.worked}
            </p>
            <div className="mt-1.5"><Badges s={s} /></div>
          </button>

          {attentionView && reasons.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5 text-[11px]" aria-label="Why it needs attention">
              {reasons.map((reason) => (
                <li key={reason} className="rounded bg-warning/15 px-1.5 py-0.5 text-warning dark:text-warning">
                  {attentionLabel(reason)}
                </li>
              ))}
            </ul>
          )}

          {tags.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <li key={tag}>
                  <button
                    type="button"
                    onClick={() => onTag(tag)}
                    aria-label={`Show only solutions tagged ${tag}`}
                    className="rounded border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    {tag}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {attentionView && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => onStillTrue(s)}
                className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-[12px] hover:bg-secondary disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Still true
              </button>
              {s.can_manage && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onEdit(s)}
                    className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-[12px] hover:bg-secondary disabled:opacity-50"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
                  </button>
                  {confirming ? (
                    <span className="inline-flex flex-wrap items-center gap-2 text-[12px]">
                      <span>Remove it?</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => { setConfirming(false); onRetract(s); }}
                        className="rounded bg-destructive px-2 py-1 text-destructive-foreground disabled:opacity-50"
                      >
                        Yes, remove
                      </button>
                      <button type="button" onClick={() => setConfirming(false)} className="rounded px-2 py-1 text-muted-foreground hover:bg-secondary">
                        Keep it
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirming(true)}
                      className="inline-flex items-center gap-1 text-[12px] text-destructive disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Retract
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
