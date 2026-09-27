import { memo, useMemo, useState } from 'react';
import { ChevronUp, ListChecks, Loader2 } from 'lucide-react';
import type { TodoItem } from '../../api/chat';
import { buildPlanView, planCounts, type StepAction } from '../../lib/planView';
import PlanView from './PlanView';

/**
 * The plan, pinned just above the composer so it never scrolls away.
 *
 * It used to render inside the streaming reply, so it slid up out of view as
 * the answer arrived — exactly while the work it describes was happening. One
 * line when collapsed ("Plan · 3/7 done · Now: checking pricing"), the full
 * list with its history when opened. Opens upward, capped at half the
 * viewport, so the composer is never covered.
 */

interface Props {
  history: TodoItem[][];
  actions?: StepAction[];
  live?: boolean;
}

function PlanDock({ history, actions, live = false }: Props) {
  const [open, setOpen] = useState(false);
  const view = useMemo(() => buildPlanView(history), [history]);
  if (!view.total) return null;

  const finished = view.done + view.blocked === view.total;
  const status = view.current
    ? `Now: ${view.current}`
    : finished ? (view.blocked ? 'Finished with blocked steps' : 'All steps done') : 'Waiting to start';

  return (
    <div className="relative mx-auto mb-2 w-full max-w-3xl">
      {open && (
        <div
          id="plan-dock-panel"
          className="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-[50vh] overflow-y-auto rounded-lg border border-border bg-background shadow-lg"
        >
          <PlanView history={history} actions={actions} bare live={live} />
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls="plan-dock-panel"
        className={`flex min-h-[36px] w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-muted/40 ${
          live ? 'border-primary/30 bg-primary/5' : 'border-border/60 bg-muted/20'}`}
      >
        {live && view.current
          ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden />
          : <ListChecks className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        <span className="shrink-0 font-medium text-foreground">Plan</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{planCounts(view)}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">· {status}</span>
        <ChevronUp className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
    </div>
  );
}

export default memo(PlanDock);
