/**
 * "Checked N team solutions" under an answer: what the assistant read from the
 * organisation's library this turn, and a way to say whether each one worked.
 *
 * It lists what was *read*, not what the answer *cited*. The label says
 * "Checked" for that reason; "Based on" would claim more than the record shows.
 *
 * It only draws. Recording a verdict is the parent's job, through `onReview`.
 * The only state kept here is what the person can see: whether the list is
 * open, and which row they already answered (so a second click cannot send a
 * second verdict from the same screen). A verdict shows at once; if the parent
 * reports that it failed (its promise rejects), the row is unlocked again.
 */
import { useId, useState } from 'react';
import { ChevronDown, ExternalLink, Users } from 'lucide-react';

import type { SolutionUsed } from '../../api/solutions';
import { cn } from '../../lib/utils';

/** The two verdicts a person can give from a chat. Doubts are the model's. */
export type SolutionVerdict = 'confirmed' | 'failed';

interface TeamSolutionsChipProps {
  items: SolutionUsed[];
  /** The organisation the solutions came from, when the chat is in one. */
  orgName?: string | null;
  /** May return a promise; a rejection puts the row back to unanswered. */
  onReview: (id: number, kind: SolutionVerdict) => void | Promise<void>;
}

/** "2026-10-02" → "2 Oct 2026". Anything unreadable is shown as it arrived. */
function formatCheckedDay(iso: string | null): string {
  if (!iso) return '';
  const day = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(day.getTime())) return iso;
  return day.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function checkedLabel(count: number): string {
  return `Checked ${count} team solution${count === 1 ? '' : 's'}`;
}

export default function TeamSolutionsChip({ items, orgName, onReview }: TeamSolutionsChipProps) {
  const [open, setOpen] = useState(false);
  const [recorded, setRecorded] = useState<Record<number, SolutionVerdict>>({});
  const panelId = useId();

  if (items.length === 0) return null;

  const record = (id: number, kind: SolutionVerdict) => {
    setRecorded(prev => ({ ...prev, [id]: kind }));
    // Optimistic: the verdict shows now. If it does not reach the server, unlock the row.
    const unlock = () => setRecorded(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      void Promise.resolve(onReview(id, kind)).catch(unlock);
    } catch {
      unlock();
    }
  };

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          'flex min-h-[32px] items-center gap-2 rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors duration-normal ease-standard',
          open
            ? 'border-primary/30 bg-primary/10 text-primary'
            : 'border-border/40 bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        )}
      >
        <Users className="h-4 w-4" />
        <span>{checkedLabel(items.length)}</span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform duration-normal ease-standard', open && 'rotate-180')}
        />
      </button>

      {/* The list is always mounted and collapses by its row height (0fr ↔ 1fr), so it
          animates without measuring. Closed, it is inert: nothing inside takes focus. */}
      <div
        id={panelId}
        inert={!open}
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-slow ease-standard',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mt-2 space-y-2 rounded-md border border-border/40 bg-muted/20 p-3">
            {orgName && (
              <p className="label-mono">
                From {orgName}
              </p>
            )}
            {items.map(item => {
              const answered = recorded[item.id];
              const checked = formatCheckedDay(item.last_known_true);
              return (
                <div key={item.id} className="min-w-0 space-y-1.5 border-t border-border/30 pt-2 first:border-t-0 first:pt-0">
                  <p className="break-words text-[13px] font-semibold text-foreground">{item.problem}</p>
                  <p className="text-[12px] text-muted-foreground">
                    {item.solved_by ? `by ${item.solved_by}` : 'by a former member'}
                    {checked ? `, last checked ${checked}` : ''}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {item.checks_needed > 0 && (
                      <span className="rounded border border-border bg-card px-1.5 py-0.5 text-[11px] font-medium text-warning">
                        may be out of date
                      </span>
                    )}
                    {item.doubtful && (
                      <span className="rounded border border-border bg-card px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                        flagged
                      </span>
                    )}
                    <a
                      href={`/solutions?id=${item.id}`}
                      className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
                    >
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      disabled={answered !== undefined}
                      aria-pressed={answered === 'confirmed'}
                      onClick={() => record(item.id, 'confirmed')}
                      className={cn(
                        'min-h-[30px] rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors duration-fast disabled:cursor-default',
                        answered === 'confirmed'
                          ? 'border-success/40 bg-success-subtle text-success'
                          : 'border-border bg-card text-foreground hover:bg-muted/50 disabled:opacity-50',
                      )}
                    >
                      Worked
                    </button>
                    <button
                      type="button"
                      disabled={answered !== undefined}
                      aria-pressed={answered === 'failed'}
                      onClick={() => record(item.id, 'failed')}
                      className={cn(
                        'min-h-[30px] rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors duration-fast disabled:cursor-default',
                        answered === 'failed'
                          ? 'border-destructive/40 bg-destructive/10 text-destructive'
                          : 'border-border bg-card text-foreground hover:bg-muted/50 disabled:opacity-50',
                      )}
                    >
                      Didn&apos;t work
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
