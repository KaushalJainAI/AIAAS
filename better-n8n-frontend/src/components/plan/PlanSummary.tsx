import { memo, useMemo, useState } from 'react';
import { ChevronRight, ListChecks } from 'lucide-react';
import type { TodoItem } from '../../api/chat';
import { buildPlanView, planCounts, type StepAction } from '../../lib/planView';
import PlanView from './PlanView';

/**
 * A finished reply's plan: one line, expandable to the full record.
 *
 * Every reply used to carry a full copy of its plan, so a long conversation
 * showed several near-identical lists and no clear "current" one. The current
 * plan lives in the dock; a saved reply keeps its record one click away.
 */

interface Props {
  history: TodoItem[][];
  actions?: StepAction[];
}

function PlanSummary({ history, actions }: Props) {
  const [open, setOpen] = useState(false);
  const view = useMemo(() => buildPlanView(history), [history]);
  if (!view.total) return null;

  if (open) {
    return (
      <div>
        <button type="button" onClick={() => setOpen(false)} aria-expanded
          className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          <ChevronRight className="h-3 w-3 rotate-90" /> Hide plan
        </button>
        <PlanView history={history} actions={actions} />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-expanded={false}
      className="my-2 flex min-h-[32px] items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1 text-[12px] text-muted-foreground hover:bg-muted/40"
    >
      <ListChecks className="h-3.5 w-3.5" aria-hidden />
      <span className="font-medium text-foreground">Plan</span>
      <span className="tabular-nums">{planCounts(view)}</span>
      <ChevronRight className="h-3 w-3" aria-hidden />
    </button>
  );
}

export default memo(PlanSummary);
