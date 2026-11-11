import { memo, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
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
  /** Whose plan this is. Left out, it is the reply's own. */
  label?: string;
}

function PlanSummary({ history, actions, label }: Props) {
  const [open, setOpen] = useState(false);
  const view = useMemo(() => buildPlanView(history), [history]);
  if (!view.total) return null;

  if (open) {
    return (
      <div>
        <button type="button" onClick={() => setOpen(false)} aria-expanded
          className="mt-3 flex min-h-10 items-center gap-1 font-mono text-[11px] lowercase text-muted-foreground hover:text-foreground md:min-h-0">
          <ChevronRight className="h-3 w-3 rotate-90" /> hide plan
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
      className="my-2 flex min-h-10 w-full max-w-xl items-center gap-2.5 rounded-md border border-border bg-card px-3 text-left text-[12px] text-muted-foreground transition-colors hover:bg-secondary md:min-h-8"
    >
      <span className="shrink-0 font-medium text-foreground">{label ? `${label}'s plan` : 'Plan'}</span>
      <span className="min-w-0 flex-1 truncate font-mono tabular-nums">{planCounts(view)}</span>
      <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
    </button>
  );
}

export default memo(PlanSummary);
