import { memo, useId, useMemo, useState } from 'react';
import { ChevronUp } from 'lucide-react';
import type { TodoItem } from '../../api/chat';
import { buildPlanView, type StepAction } from '../../lib/planView';
import PlanView from './PlanView';

/**
 * The plan, pinned to the top edge of the composer so it never scrolls away.
 *
 * It used to render inside the streaming reply, so it slid up out of view as
 * the answer arrived — exactly while the work it describes was happening. Now
 * a slim bar: one segment per step (done in agent colour, the current step
 * pulsing, blocked in warning), then "4/7 · current step". Opening it shows the
 * full list with its history, upward, capped at half the viewport.
 */

interface Props {
  history: TodoItem[][];
  actions?: StepAction[];
  live?: boolean;
  /** Whose plan this is. Left out, it is the chat's own. */
  label?: string;
}

function segmentClass(status: TodoItem['status'], current: boolean): string {
  if (status === 'done') return 'bg-agent';
  if (status === 'blocked') return 'bg-warning';
  if (status === 'doing' || current) return 'bg-agent animate-agent-pulse';
  return 'bg-muted';
}

function PlanDock({ history, actions, live = false, label }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const view = useMemo(() => buildPlanView(history), [history]);
  if (!view.total) return null;

  // Segments follow the latest list; dropped and removed steps are not a step
  // any more, so they do not get a segment.
  const steps = view.items.filter(i => i.change !== 'dropped' && i.change !== 'removed');
  const finished = view.done + view.blocked === view.total;
  const status = view.current
    ? view.current
    : finished ? (view.blocked ? 'finished with blocked steps' : 'all steps done') : 'waiting to start';

  return (
    <div className="relative mx-auto w-full max-w-3xl">
      {open && (
        <div
          id={panelId}
          className="absolute bottom-full left-0 right-0 z-20 max-h-[50vh] overflow-y-auto rounded-t-md border border-border bg-card"
        >
          <PlanView history={history} actions={actions} bare live={live} />
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-10 w-full items-center gap-2.5 rounded-t-md border border-b-0 border-border bg-card px-3 text-left text-[12px] transition-colors hover:bg-secondary md:min-h-8"
      >
        {live && view.current && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-agent animate-agent-pulse" aria-hidden />
        )}
        {label && <span className="shrink-0 font-medium text-foreground">{label}&apos;s plan</span>}
        <span className="flex h-1 w-20 shrink-0 gap-px overflow-hidden rounded bg-muted sm:w-28" aria-hidden>
          {steps.map((s, i) => (
            <span key={`${s.key}-${i}`} className={`h-full flex-1 ${segmentClass(s.status, !!view.current && s.text === view.current)}`} />
          ))}
        </span>
        <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
          {view.done}/{view.total}
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">· {status}</span>
        {view.blocked > 0 && (
          <span className="shrink-0 font-mono text-warning">{view.blocked} blocked</span>
        )}
        <ChevronUp className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
    </div>
  );
}

export default memo(PlanDock);
