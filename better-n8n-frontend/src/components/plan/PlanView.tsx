import { memo, useMemo, useState } from 'react';
import { Ban, Check, ChevronRight, CircleDashed, History, Loader2, MinusCircle } from 'lucide-react';
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
 */

interface Props {
  history: TodoItem[][];
  /** Tool calls carrying the `step` they were made for. */
  actions?: StepAction[];
  /** No outer frame and header — the dock draws its own. */
  bare?: boolean;
  live?: boolean;
}

const ICONS = {
  done: Check,
  doing: Loader2,
  blocked: Ban,
  open: CircleDashed,
} as const;

const TAG = {
  added: { label: 'added', className: 'border-primary/40 text-primary' },
  dropped: { label: 'dropped', className: 'border-amber-500/50 text-amber-600 dark:text-amber-400' },
  removed: { label: 'removed', className: 'border-border text-muted-foreground' },
} as const;

function iconClass(item: PlanItemView): string {
  if (item.change === 'dropped' || item.change === 'removed') return 'text-muted-foreground/60';
  switch (item.status) {
    case 'done': return 'text-emerald-500';
    case 'doing': return 'animate-spin text-primary';
    case 'blocked': return 'text-amber-500';
    default: return 'text-muted-foreground/50';
  }
}

function textClass(item: PlanItemView): string {
  if (item.change === 'dropped' || item.change === 'removed') {
    return 'text-muted-foreground line-through decoration-muted-foreground/50';
  }
  if (item.status === 'done') return 'text-muted-foreground line-through decoration-muted-foreground/40';
  if (item.status === 'blocked') return 'text-muted-foreground';
  return 'text-foreground';
}

function PlanRow({ item, actions }: { item: PlanItemView; actions: StepAction[] }) {
  const [open, setOpen] = useState(false);
  const gone = item.change === 'dropped' || item.change === 'removed';
  const Icon = gone ? MinusCircle : (ICONS[item.status] ?? CircleDashed);
  const tag = item.change ? TAG[item.change] : null;

  return (
    <li className="rounded px-1.5 py-1 text-[12px] leading-snug">
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 h-3 w-3 shrink-0 ${iconClass(item)}`} aria-hidden />
        <span className="sr-only">{gone ? item.change : item.status}:</span>
        <span className={`min-w-0 flex-1 ${textClass(item)}`}>{item.text}</span>
        {item.owner && (
          <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
            {item.owner}
          </span>
        )}
        {tag && (
          <span className={`shrink-0 rounded border px-1 text-[10px] ${tag.className}`}>
            {tag.label}
          </span>
        )}
        {actions.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            className="flex shrink-0 items-center gap-0.5 rounded px-1 text-[10px] tabular-nums text-muted-foreground hover:bg-muted"
          >
            {actions.length} action{actions.length === 1 ? '' : 's'}
            <ChevronRight className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
          </button>
        )}
      </div>
      {item.note && (
        <p className={`ml-5 mt-0.5 text-[11px] ${
          item.status === 'blocked' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
          {item.status === 'blocked' ? 'Why: ' : ''}{item.note}
        </p>
      )}
      {item.status === 'blocked' && !item.note && !gone && (
        <p className="ml-5 mt-0.5 text-[11px] text-muted-foreground">No reason given.</p>
      )}
      {open && (
        <ul className="ml-5 mt-1 list-none space-y-0.5 border-l border-border/60 pl-2">
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

  const body = (
    <>
      {/* One bar, one number, same scale — the bar is the count, not a mood. */}
      <div className="h-0.5 w-full bg-muted">
        <div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>

      <ul className="m-0 list-none space-y-0.5 p-2">
        {view.items.map(item => (
          <PlanRow key={`${item.change ?? 'live'}-${item.key}`} item={item}
            actions={byStep.get(item.key) ?? []} />
        ))}
      </ul>

      {view.revisions.length > 1 && (
        <div className="border-t border-border/60 px-3 py-1.5">
          <button
            type="button"
            onClick={() => setShowHistory(s => !s)}
            aria-expanded={showHistory}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <History className="h-3 w-3" />
            Plan history ({view.revisions.length} revisions)
            <ChevronRight className={`h-3 w-3 transition-transform ${showHistory ? 'rotate-90' : ''}`} />
          </button>
          {showHistory && (
            <ol className="mt-1 list-none space-y-1 pl-0">
              {view.revisions.map(rev => (
                <li key={rev.n} className="flex gap-2 text-[11px] leading-snug">
                  <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">{rev.n}.</span>
                  <span className={rev.dropped.length ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>
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
    <div className={`my-3 overflow-hidden rounded-lg border bg-muted/20 ${
      live ? 'border-primary/30' : 'border-border/60'}`}>
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Plan</span>
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
          {planCounts(view)}
        </span>
      </div>
      {body}
    </div>
  );
}

export default memo(PlanView);
