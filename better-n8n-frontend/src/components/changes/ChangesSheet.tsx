/**
 * "Undo what this run changed": the files, folders, memory and agent settings
 * a chat answer or a run changed, with a checkbox per change that can be put
 * back from here.
 *
 * Props only. `ChangesSheetContainer` loads the tree and runs the revert; this
 * draws what it is given and reports the ids the person ticked. A side sheet
 * on a desktop, a bottom sheet on a phone. Escape closes.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import type {
  ChangeRow,
  ChangeSetDetail,
  ChangeSetNode,
  RevertResult,
} from '@/api/changes';

export interface ChangesSheetProps {
  /** The tree, once loaded. */
  detail?: ChangeSetDetail;
  loading: boolean;
  /** A load failure, in plain words. */
  error?: string;
  onRetry: () => void;
  /** True while a revert is on its way. */
  reverting: boolean;
  /** What the last revert said. Its outcomes replace each row's stored outcome. */
  result: RevertResult | null;
  /** The ids the person left ticked. Only changes that can still be undone. */
  onRevert: (changeIds: number[]) => void;
  onClose: () => void;
}

/** One change with the name of the set (the run, or a worker) it belongs to. */
interface Entry {
  row: ChangeRow;
  worker: string;
}

/** Flatten the tree: the set's own changes first, then each worker's, in order. */
function collect(node: ChangeSetNode, worker: string, out: Entry[]): Entry[] {
  for (const row of node.changes) out.push({ row, worker });
  node.children.forEach((kid, i) => {
    const name = worker.startsWith('Worker')
      ? `${worker} · ${i + 1}`
      : `Worker ${i + 1}`;
    collect(kid, name, out);
  });
  return out;
}

/** Any set in the tree left some changes out of the list. */
function anyIncomplete(node: ChangeSetNode): boolean {
  return node.incomplete || node.children.some(anyIncomplete);
}

/** Ticked unless it was already tried: a retry of a skipped row is one tick away. */
function defaultTicked(row: ChangeRow): boolean {
  return row.revertible && row.outcome === '';
}

interface OutcomeLine {
  text: string;
  tone: string;
}

/** The words under a row: this revert's answer first, then what the row already stored. */
function outcomeFor(row: ChangeRow, result: RevertResult | null): OutcomeLine | null {
  const fromRun = result?.outcomes.find((o) => o.change_id === row.id);
  if (fromRun) {
    switch (fromRun.outcome) {
      case 'reverted':
        return { text: 'Undone', tone: 'text-success' };
      case 'skipped':
        return { text: `Skipped: ${fromRun.note}`, tone: 'text-muted-foreground' };
      case 'failed':
        return { text: `Failed: ${fromRun.note}`, tone: 'text-destructive' };
      case 'not_revertible':
        return null; // the reason is already drawn under the row
    }
  }
  if (row.outcome === 'reverted') return { text: 'Undone', tone: 'text-success' };
  if (row.outcome === 'skipped') {
    return { text: `Skipped: ${row.outcome_note}`, tone: 'text-muted-foreground' };
  }
  if (row.outcome === 'failed') {
    return { text: `Failed: ${row.outcome_note}`, tone: 'text-destructive' };
  }
  return null;
}

export function ChangesSheet({
  detail,
  loading,
  error,
  onRetry,
  reverting,
  result,
  onRevert,
  onClose,
}: ChangesSheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  /** Only the person's own ticks: everything else follows the defaults. */
  const [overrides, setOverrides] = useState<Record<number, boolean>>({});

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const entries = detail ? collect(detail.set, rootName(detail.set), []) : [];
  const ticked = (row: ChangeRow) =>
    row.id in overrides ? overrides[row.id] : defaultTicked(row);
  const undoable = entries.filter(({ row }) => row.revertible && row.outcome !== 'reverted');
  const pickedIds = undoable.filter(({ row }) => ticked(row)).map(({ row }) => row.id);
  const live = detail?.live ?? false;
  const incomplete = detail ? anyIncomplete(detail.set) : false;

  const revertibleEntries = entries.filter(({ row }) => row.revertible);
  const blockedEntries = entries.filter(({ row }) => !row.revertible);

  const toggle = (row: ChangeRow) =>
    setOverrides((prev) => ({ ...prev, [row.id]: !ticked(row) }));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:justify-end" onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'flex w-full max-h-[92dvh] flex-col rounded-t-xl border-t border-border bg-card text-foreground shadow-xl outline-none',
          'md:h-full md:max-h-none md:w-[440px] md:rounded-none md:border-l md:border-t-0',
          'pb-[env(safe-area-inset-bottom)] md:pb-0',
        )}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold">Undo what this run changed</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Files go back to how they were before. Anything you changed since is left alone.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading && <p role="status" className="text-sm text-muted-foreground">Loading the changes…</p>}

          {error && !loading && (
            <div role="alert" className="space-y-3">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>
            </div>
          )}

          {detail && !loading && (
            <>
              {live && (
                <p role="status" className="rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-sm text-foreground">
                  {detail.live_reason ?? 'A run is still changing things.'} Undo is available once it finishes.
                </p>
              )}
              {incomplete && (
                <p className="text-sm text-muted-foreground">Some changes may be missing from this list.</p>
              )}
              {detail.truncated && (
                <p className="text-sm text-muted-foreground">
                  Only some of the {detail.total} changes are listed.
                </p>
              )}
              {detail.total === 0 && (
                <p className="text-sm text-muted-foreground">Nothing was changed, so there is nothing to undo.</p>
              )}

              {revertibleEntries.length > 0 && (
                <Section title="Can be undone">
                  {groupByWorker(revertibleEntries).map(({ worker, items }) => (
                    <WorkerGroup key={worker} worker={worker}>
                      {items.map(({ row }) => {
                        if (row.outcome === 'reverted') {
                          // Already put back: no checkbox, nothing left to choose.
                          return (
                            <li key={row.id} className="flex min-h-11 items-start gap-3 px-2 py-2">
                              <span className="min-w-0 flex-1">
                                <Label row={row} />
                                <OutcomeText line={{ text: 'Undone', tone: 'text-success' }} />
                              </span>
                            </li>
                          );
                        }
                        const outcome = outcomeFor(row, result);
                        return (
                          <li key={row.id}>
                            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
                              <input
                                type="checkbox"
                                className="mt-1 h-4 w-4 shrink-0 accent-primary"
                                checked={ticked(row)}
                                disabled={reverting}
                                onChange={() => toggle(row)}
                              />
                              <span className="min-w-0 flex-1">
                                <Label row={row} />
                                {outcome && <OutcomeText line={outcome} />}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </WorkerGroup>
                  ))}
                </Section>
              )}

              {blockedEntries.length > 0 && (
                <Section title="Can't be undone from here">
                  {groupByWorker(blockedEntries).map(({ worker, items }) => (
                    <WorkerGroup key={worker} worker={worker}>
                      {items.map(({ row }) => (
                        <li key={row.id} className="flex min-h-11 flex-col gap-0.5 px-2 py-2">
                          <Label row={row} />
                          <span className="text-xs text-muted-foreground">
                            {row.reason || 'This cannot be undone from here.'}
                          </span>
                        </li>
                      ))}
                    </WorkerGroup>
                  ))}
                </Section>
              )}
            </>
          )}
        </div>

        {detail && !loading && detail.total > 0 && (
          <div className="shrink-0 border-t border-border px-5 py-4">
            <Button
              className="w-full md:w-auto"
              disabled={live || pickedIds.length === 0}
              loading={reverting}
              onClick={() => onRevert(pickedIds)}
            >
              {pickedIds.length === 1 ? 'Undo 1 change' : `Undo ${pickedIds.length} changes`}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The set's own name: the run's changes read as "This run", a chat answer's as "This answer". */
function rootName(set: ChangeSetNode): string {
  return set.owner_kind === 'run' ? 'This run' : 'This answer';
}

function groupByWorker(entries: { row: ChangeRow; worker: string }[]) {
  const groups: { worker: string; items: { row: ChangeRow; worker: string }[] }[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.worker === entry.worker) last.items.push(entry);
    else groups.push({ worker: entry.worker, items: [entry] });
  }
  return groups;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** One set's rows under its name: the run's own, or a worker's. */
function WorkerGroup({ worker, children }: { worker: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="px-2 text-xs font-medium text-muted-foreground">{worker}</p>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

function Label({ row }: { row: ChangeRow }) {
  return <span className="block min-w-0 break-words text-sm text-foreground">{row.label}</span>;
}

function OutcomeText({ line }: { line: OutcomeLine }) {
  return <span className={cn('mt-0.5 block text-xs', line.tone)}>{line.text}</span>;
}
