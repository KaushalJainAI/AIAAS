import { memo, useMemo, useState } from 'react';
import { ChevronRight, History } from 'lucide-react';
import type { TodoItem } from '../../api/chat';
import {
  actionLabel,
  actionsByStep,
  buildPlanView,
  describeRevision,
  planCounts,
  type PlanItemView,
  type StepAction,
} from '../../lib/planView';

/**
 * The one way a plan is drawn — in the dock above the composer, in a saved
 * reply, in the team side panel and on `/runs`.
 *
 * It shows the latest list *and* what changed to get there: steps added after
 * the original plan are tagged, steps removed while unfinished stay visible as
 * "dropped", a blocked step says why, and each step lists the tool calls made
 * for it. The list alone cannot show any of that, because `update_todos`
 * replaces it wholesale.
 *
 * Steps are numbered in mono. The current step is in the agent colour, done
 * steps are muted, and the owner sits on the right.
 */

interface Props {
  history: TodoItem[][];
  /** Tool calls carrying the `step` they were made for. */
  actions?: StepAction[];
  /** No outer frame and header — the dock and team panel draw their own. */
  bare?: boolean;
  live?: boolean;
}

const TAG = {
  added: { label: 'added', className: 'border-agent-line text-agent' },
  dropped: { label: 'dropped', className: 'border-warning/50 text-warning' },
  removed: { label: 'removed', className: 'border-border text-muted-foreground' },
} as const;

function numberClass(item: PlanItemView): string {
  if (item.change === 'dropped' || item.change === 'removed') return 'text-muted-foreground/60';
  switch (item.status) {
    case 'done': return 'text-muted-foreground';
    case 'doing': return 'font-semibold text-agent';
    case 'blocked': return 'text-warning';
    default: return 'text-muted-foreground/70';
  }
}

function textClass(item: PlanItemView): string {
  if (item.change === 'dropped' || item.change === 'removed') {
    return 'text-muted-foreground line-through decoration-muted-foreground/50';
  }
  if (item.status === 'done') return 'text-muted-foreground';
  if (item.status === 'doing') return 'font-medium text-agent';
  if (item.status === 'blocked') return 'text-muted-foreground';
  return 'text-foreground';
}

function PlanRow({ item, number, actions }: { item: PlanItemView; number: string; actions: StepAction[] }) {
  const [open, setOpen] = useState(false);
  const gone = item.change === 'dropped' || item.change === 'removed';
  const tag = item.change ? TAG[item.change] : null;

  return (
    <li className="rounded px-1.5 py-1 text-[13px] leading-snug">
      <div className="flex items-baseline gap-2.5">
        <span className={`w-5 shrink-0 text-right font-mono text-[11px] tabular-nums ${numberClass(item)}`} aria-hidden>
          {number}
        </span>
        <span className="sr-only">{gone ? item.change : item.status}:</span>
        <span className={`min-w-0 flex-1 ${textClass(item)}`}>{item.text}</span>
        {tag && (
          <span className={`shrink-0 rounded border px-1 font-mono text-[10px] ${tag.className}`}>
            {tag.label}
          </span>
        )}
        {item.owner && (
          <span className="shrink-0 text-[11px] text-muted-foreground">{item.owner}</span>
        )}
        {actions.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            className="flex min-h-10 shrink-0 items-center gap-0.5 font-mono text-[11px] tabular-nums text-muted-foreground hover:text-foreground md:min-h-0"
          >
            {actions.length} action{actions.length === 1 ? '' : 's'}
            <ChevronRight className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
          </button>
        )}
      </div>
      {item.note && (
        <p className={`ml-[30px] mt-0.5 text-[12px] ${
          item.status === 'blocked' ? 'text-warning' : 'text-muted-foreground'}`}>
          {item.status === 'blocked' ? 'Why: ' : ''}{item.note}
        </p>
      )}
      {item.status === 'blocked' && !item.note && !gone && (
        <p className="ml-[30px] mt-0.5 text-[12px] text-muted-foreground">No reason given.</p>
      )}
      {open && (
        <ul className="ml-[30px] mt-1 list-none space-y-0.5 border-l border-border pl-2">
          {actions.map((a, i) => (
            <li key={i} className="truncate font-mono text-[11px] text-muted-foreground">
              {actionLabel(a)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function PlanView({ history, actions = [], bare = false, live = false }: Props) {
  const view = useMemo(() => buildPlanView(history), [history]);
  const byStep = useMemo(() => actionsByStep(actions), [actions]);
  const [showHistory, setShowHistory] = useState(false);

  if (!view.total && !view.items.length) return null;
  const pct = view.total ? Math.round((view.done / view.total) * 100) : 0;

  // Live steps are numbered in order; steps that were dropped or removed keep
  // their place at the end and carry a dash instead of a number.
  let n = 0;
  const numbered = view.items.map(item => {
    const gone = item.change === 'dropped' || item.change === 'removed';
    return { item, number: gone ? '–' : `${++n}` };
  });

  const body = (
    <>
      {/* One bar, one number, same scale — the bar is the count, not a mood. */}
      <div className="h-0.5 w-full bg-muted">
        <div className="h-full bg-agent transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>

      <ul className="m-0 list-none space-y-0.5 p-2">
        {numbered.map(({ item, number }) => (
          <PlanRow key={`${item.change ?? 'live'}-${item.key}`} item={item} number={number}
            actions={byStep.get(item.key) ?? []} />
        ))}
      </ul>

      {view.revisions.length > 1 && (
        <div className="border-t border-border px-3 py-1.5">
          <button
            type="button"
            onClick={() => setShowHistory(s => !s)}
            aria-expanded={showHistory}
            className="flex min-h-10 items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground md:min-h-0"
          >
            <History className="h-3 w-3" />
            plan history ({view.revisions.length} revisions)
            <ChevronRight className={`h-3 w-3 transition-transform ${showHistory ? 'rotate-90' : ''}`} />
          </button>
          {showHistory && (
            <ol className="mt-1 list-none space-y-1 pl-0">
              {view.revisions.map(rev => (
                <li key={rev.n} className="flex gap-2 text-[12px] leading-snug">
                  <span className="w-5 shrink-0 text-right font-mono tabular-nums text-muted-foreground">{rev.n}.</span>
                  <span className={rev.dropped.length ? 'text-warning' : 'text-muted-foreground'}>
                    {describeRevision(rev)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </>
  );

  if (bare) return body;

  return (
    <div className={`my-3 overflow-hidden rounded-md border bg-card ${
      live ? 'border-agent-line' : 'border-border'}`}>
      <div className="flex h-9 items-center gap-2 border-b border-border px-3">
        <span className="font-mono text-[12px] lowercase text-muted-foreground">plan</span>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
          {planCounts(view)}
        </span>
      </div>
      {body}
    </div>
  );
}

export default memo(PlanView);
