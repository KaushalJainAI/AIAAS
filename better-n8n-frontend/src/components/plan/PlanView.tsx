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

// Changes are a quiet word, not a badge: only "dropped" (left unfinished)
// earns a colour, because it is the one a reader should notice.
const TAG = {
  added: { label: 'added', className: 'text-muted-foreground/70' },
  dropped: { label: 'dropped', className: 'text-warning/80' },
  removed: { label: 'removed', className: 'text-muted-foreground/70' },
} as const;

function numberClass(item: PlanItemView): string {
  if (item.change === 'dropped' || item.change === 'removed') return 'text-muted-foreground/40';
  switch (item.status) {
    case 'doing': return 'text-agent';
    case 'blocked': return 'text-warning';
    default: return 'text-muted-foreground/60';
  }
}

function textClass(item: PlanItemView): string {
  if (item.change === 'dropped' || item.change === 'removed') {
    return 'text-muted-foreground/60 line-through decoration-muted-foreground/30';
  }
  if (item.status === 'done') return 'text-muted-foreground';
  if (item.status === 'doing') return 'font-medium text-foreground';
  return 'text-foreground/90';
}

// Number column and the indent of anything under a row share one width.
const INDENT = 'pl-7';

function PlanRow({ item, number, actions }: { item: PlanItemView; number: string; actions: StepAction[] }) {
  const [open, setOpen] = useState(false);
  const gone = item.change === 'dropped' || item.change === 'removed';
  const tag = item.change ? TAG[item.change] : null;

  return (
    <li className="py-1.5 text-[13px] leading-5">
      <div className="flex items-start gap-3">
        <span className={`w-4 shrink-0 text-right text-[12px] tabular-nums leading-5 ${numberClass(item)}`} aria-hidden>
          {number}
        </span>
        <span className="sr-only">{gone ? item.change : item.status}:</span>
        <span className={`min-w-0 flex-1 ${textClass(item)}`}>{item.text}</span>
        {(tag || item.owner || actions.length > 0) && (
          <span className="flex shrink-0 items-center gap-3 text-[11px] leading-5 text-muted-foreground">
            {item.owner && <span>{item.owner}</span>}
            {tag && <span className={tag.className}>{tag.label}</span>}
            {actions.length > 0 && (
              <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                aria-label={`${actions.length} action${actions.length === 1 ? '' : 's'}`}
                className="-my-2 flex min-h-10 items-center gap-0.5 tabular-nums transition-colors hover:text-foreground md:my-0 md:min-h-0"
              >
                {actions.length}
                <ChevronRight className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
              </button>
            )}
          </span>
        )}
      </div>
      {item.note && (
        <p className={`${INDENT} mt-0.5 text-[12px] leading-5 ${
          item.status === 'blocked' ? 'text-warning/90' : 'text-muted-foreground'}`}>
          {item.note}
        </p>
      )}
      {item.status === 'blocked' && !item.note && !gone && (
        <p className={`${INDENT} mt-0.5 text-[12px] leading-5 text-muted-foreground`}>Blocked — no reason given.</p>
      )}
      {open && (
        <ul className={`${INDENT} mt-1 list-none space-y-0.5`}>
          {actions.map((a, i) => (
            <li key={i} className="truncate font-mono text-[11px] leading-5 text-muted-foreground">
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
      {/* One bar, one number, same scale — the bar is the count, not a mood.
          The dock draws its own bar, so a bare view does not repeat it. */}
      {!bare && (
        <div className="h-px w-full bg-border">
          <div className="h-full bg-agent transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      )}

      <ul className="m-0 list-none px-3 py-2">
        {numbered.map(({ item, number }) => (
          <PlanRow key={`${item.change ?? 'live'}-${item.key}`} item={item} number={number}
            actions={byStep.get(item.key) ?? []} />
        ))}
      </ul>

      {view.revisions.length > 1 && (
        <div className="border-t border-border/60 px-3 py-1.5">
          <button
            type="button"
            onClick={() => setShowHistory(s => !s)}
            aria-expanded={showHistory}
            className="flex min-h-10 items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground md:min-h-7"
          >
            <History className="h-3 w-3" />
            History · {view.revisions.length} revisions
            <ChevronRight className={`h-3 w-3 transition-transform ${showHistory ? 'rotate-90' : ''}`} />
          </button>
          {showHistory && (
            <ol className="mb-1 mt-1 list-none space-y-1 pl-0">
              {view.revisions.map(rev => (
                <li key={rev.n} className="flex gap-3 text-[12px] leading-5">
                  <span className="w-4 shrink-0 text-right tabular-nums text-muted-foreground/60">{rev.n}</span>
                  <span className={rev.dropped.length ? 'text-warning/80' : 'text-muted-foreground'}>
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
      <div className="flex h-9 items-center gap-2 px-3">
        <span className="text-[12px] font-medium text-muted-foreground">Plan</span>
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
          {planCounts(view)}
        </span>
      </div>
      {body}
    </div>
  );
}

export default memo(PlanView);
