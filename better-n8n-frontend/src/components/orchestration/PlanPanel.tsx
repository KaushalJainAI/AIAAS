import { memo, useEffect, useState } from 'react';
import { ChevronUp, X } from 'lucide-react';
import agentsService from '../../api/agents';
import type { TodoItem } from '../../api/chat';
import PlanView from '../plan/PlanView';
import { planProgress, type PlanChange, type PlanLease, type PlanTask } from '../../lib/planStream';
import { apiErrorMessage } from '../../lib/apiError';
import { toast } from 'sonner';

/**
 * The Team panel: the lead's plan on top, one card per worker, locks and
 * recent changes below.
 *
 * Right-side and sticky on chat and `/runs`; a bottom sheet behind a progress
 * pill on phones. `memo`'d and fed from `usePlanStream` so worker heartbeats
 * never re-render the transcript — the ticking clock lives in
 * <ElapsedTime/>, which owns its own interval for the same reason
 * <ThinkingTimer/> does.
 *
 * Chats with no delegation show the plan in the dock above the composer: when a run has
 * tasks the transcript shows a one-line pill that focuses this panel instead
 * of repeating the list.
 */

interface Props {
  todos: TodoItem[];
  /** Every revision of the plan, so the panel can show what changed. */
  todoHistory?: TodoItem[][];
  tasks: PlanTask[];
  leases: PlanLease[];
  changes: PlanChange[];
  /** Replay mode (`/runs`): lanes render without action buttons. */
  readOnly?: boolean;
}

/** A clock that ticks without re-rendering anything above it. */
function ElapsedTime({ since }: { since?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [since]);
  if (since == null) return null;
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const mm = Math.floor(s / 60);
  const ss = `${s % 60}`.padStart(2, '0');
  return <span className="font-mono tabular-nums text-muted-foreground">{mm}:{ss}</span>;
}

/** Two-letter mono initials for the agent badge: "Lead Dev" → "LD", "Analyst" → "An". */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const raw = words.length >= 2
    ? `${words[0][0]}${words[1][0]}`
    : (words[0] ?? '').slice(0, 2);
  if (!raw) return '··';
  return raw[0].toUpperCase() + raw.slice(1).toLowerCase();
}

/** Tag, bar and whether the card gets the violet top line, per worker state. */
function stateOf(status: string): {
  label: string;
  tag: string;
  bar: string;
  barWidth: string;
  border: string;
} {
  switch (status) {
    case 'running':
      return {
        label: 'running', tag: 'bg-agent-subtle text-agent', bar: 'bg-agent animate-agent-pulse',
        barWidth: 'w-full', border: 'border-border',
      };
    case 'paused':
      return {
        label: 'waiting', tag: 'bg-warning-subtle text-warning', bar: 'bg-warning',
        barWidth: 'w-full', border: 'border-warning/40',
      };
    case 'done':
      return {
        label: 'done', tag: 'text-success', bar: 'bg-success', barWidth: 'w-full',
        border: 'border-border',
      };
    case 'failed':
      return {
        label: 'failed', tag: 'bg-destructive-subtle text-destructive', bar: 'bg-destructive',
        barWidth: 'w-full', border: 'border-border',
      };
    case 'cancelled':
      return {
        label: 'stopped', tag: 'bg-muted text-muted-foreground', bar: 'bg-muted-foreground/40',
        barWidth: 'w-full', border: 'border-border',
      };
    default:
      return {
        label: 'queued', tag: 'bg-muted text-muted-foreground', bar: 'bg-muted-foreground/40',
        barWidth: 'w-0', border: 'border-border',
      };
  }
}

const BUTTON =
  'inline-flex h-10 shrink-0 items-center rounded-md border border-border px-2.5 text-[12px] hover:bg-secondary disabled:opacity-50 md:h-7 md:px-2';

function WorkerLane({ task, readOnly }: { task: PlanTask; readOnly: boolean }) {
  const [steerOpen, setSteerOpen] = useState(false);
  const [steerText, setSteerText] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [autonomy, setAutonomy] = useState('');
  const state = stateOf(task.status);
  const live = task.status === 'running' || task.status === 'paused';

  const sendSteer = async () => {
    const message = steerText.trim();
    if (!message || !task.execution_id) return;
    setBusy(true);
    try {
      await agentsService.steerRun(task.execution_id, message);
      setSteerText('');
      setSteerOpen(false);
      toast.success(`Steered ${task.label}`);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not steer the worker'));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!task.execution_id) return;
    if (!confirmStop) {
      setConfirmStop(true);
      return;
    }
    setBusy(true);
    try {
      await agentsService.cancelRun(task.execution_id);
      toast.success(`Stopped ${task.label} — its changes stay for review`);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not stop the worker'));
    } finally {
      setBusy(false);
      setConfirmStop(false);
    }
  };

  const switchAutonomy = async (level: string) => {
    if (!level || !task.execution_id) return;
    setBusy(true);
    try {
      await agentsService.setWorkerAutonomy(task.execution_id, level as 'ask' | 'auto' | 'review' | 'full');
      setAutonomy('');
      toast.success(`${task.label} now asks ${level === 'full' ? 'nothing' : `at ${level}`}`);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not change autonomy'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`relative overflow-hidden rounded-md border bg-card p-2.5 ${state.border}`}>
      {task.status === 'running' && (
        <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-agent" />
      )}

      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-agent-subtle font-mono text-[10px] font-semibold text-agent"
        >
          {initialsOf(task.label || task.agent || '')}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{task.label || task.task_id}</span>
        {live && <ElapsedTime since={task.started_at_ms} />}
        {task.tokens > 0 && (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{task.tokens} tok</span>
        )}
        <span className={`h-5 shrink-0 rounded px-1.5 font-mono text-[11px] leading-5 ${state.tag}`}>
          {state.label}
        </span>
      </div>

      <div className="mt-1 truncate text-[12px] text-muted-foreground">
        {task.title || task.task_id}
      </div>

      <div className="mt-2 h-[3px] overflow-hidden rounded bg-muted" aria-hidden>
        <div className={`h-full rounded ${state.bar} ${state.barWidth}`} />
      </div>

      {!readOnly && live && (
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSteerOpen((v) => !v)}
            className={BUTTON}
            title="Send an instruction to this worker"
          >
            Steer
          </button>
          {task.execution_id && (
            <a
              href={`/runs/${task.execution_id}`}
              target="_blank"
              rel="noreferrer"
              className={BUTTON}
              title="Open this worker's run"
            >
              Open run
            </a>
          )}
          <button
            type="button"
            onClick={stop}
            disabled={busy}
            className={`${BUTTON} ${confirmStop ? 'border-destructive text-destructive' : ''}`}
            title="Stop this worker (its changes stay)"
          >
            {confirmStop ? 'Confirm' : 'Stop'}
          </button>
          <select
            value={autonomy}
            onChange={(e) => switchAutonomy(e.target.value)}
            disabled={busy}
            aria-label={`How much ${task.label} asks`}
            className="ml-auto h-10 min-w-0 rounded-md border border-border bg-transparent px-1.5 text-[12px] text-muted-foreground md:h-7"
            title="How much this worker asks"
          >
            <option value="">Ask…</option>
            <option value="review">Review</option>
            <option value="ask">Ask</option>
            <option value="auto">Auto</option>
            <option value="full">Full</option>
          </select>
        </div>
      )}

      {steerOpen && !readOnly && (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            value={steerText}
            onChange={(e) => setSteerText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') sendSteer();
            }}
            placeholder={`Steer ${task.label}…`}
            className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[12px] md:h-7"
          />
          <button
            type="button"
            onClick={sendSteer}
            disabled={busy || !steerText.trim()}
            className={BUTTON}
            title="Send"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}

/** "Team", the worker count, and the time while anyone is still working. */
function PanelHeader({ tasks, onClose }: { tasks: PlanTask[]; onClose?: () => void }) {
  const liveStarts = tasks
    .filter((t) => t.status === 'running' || t.status === 'paused')
    .map((t) => t.started_at_ms)
    .filter((ms): ms is number => typeof ms === 'number');
  const since = liveStarts.length ? Math.min(...liveStarts) : undefined;
  const count = tasks.length;
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-inherit px-3.5">
      <span className="text-[14px] font-semibold">Team</span>
      {count > 0 && (
        <span className="text-[12px] text-muted-foreground">
          {count} worker{count === 1 ? '' : 's'}
        </span>
      )}
      <span className="ml-auto flex items-center gap-2 text-[11px]">
        <ElapsedTime since={since} />
      </span>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close team"
          className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary md:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function PanelBody({ todos, todoHistory, tasks, leases, changes, readOnly }: Props) {
  const { done, total, running } = planProgress(tasks);
  const showPlan = todos.length > 0;
  const showTasks = tasks.length > 0;
  const planDone = todos.filter((t) => t.status === 'done').length;

  if (!showPlan && !showTasks && leases.length === 0 && changes.length === 0) {
    return <p className="px-3.5 py-4 text-[12px] text-muted-foreground">No team task running.</p>;
  }

  return (
    <div className="space-y-4 p-3">
      {showPlan && (
        <section>
          <div className="label-mono mb-1.5">
            run plan · {planDone} of {todos.length}
          </div>
          {/* The same component as the dock and saved replies, so a team
              run shows dropped steps, reasons and history the same way. */}
          <PlanView history={todoHistory?.length ? todoHistory : [todos]} bare />
        </section>
      )}

      {showTasks && (
        <section className="space-y-2">
          <div className="label-mono flex items-center gap-2">
            workers
            {running > 0 && (
              <span className="ml-auto font-mono normal-case tabular-nums text-muted-foreground">
                {done}/{total} done · {running} running
              </span>
            )}
          </div>
          {tasks.map((t) => (
            <WorkerLane key={t.handle} task={t} readOnly={!!readOnly} />
          ))}
        </section>
      )}

      {leases.length > 0 && (
        <section>
          <div className="label-mono mb-1.5">locked files</div>
          <ul className="m-0 list-none space-y-1 p-0">
            {leases.map((l) => (
              <li key={l.pattern} className="flex items-center gap-2 font-mono text-[12px]">
                <span className="min-w-0 flex-1 truncate">{l.pattern}</span>
                <span className="shrink-0 font-sans text-[11px] text-muted-foreground">{l.holder_label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {changes.length > 0 && (
        <section>
          <div className="label-mono mb-1.5">changes</div>
          <ul className="m-0 list-none space-y-1 p-0">
            {changes.slice(0, 8).map((c, i) => (
              <li key={`${c.path}-${i}`} className="flex items-center gap-2 font-mono text-[12px]">
                <span className="min-w-0 flex-1 truncate">{c.path}</span>
                <span className="shrink-0 font-sans text-[11px] text-muted-foreground">{c.by_label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function PlanPanel(props: Props) {
  const { tasks } = props;
  const { done, total, running } = planProgress(tasks);
  const [sheetOpen, setSheetOpen] = useState(false);
  const hasTeam = tasks.length > 0;

  return (
    <>
      {/* Desktop: a sticky right rail beside the transcript. */}
      <aside className="hidden w-[300px] shrink-0 md:block">
        <div className="sticky top-0 flex max-h-[100dvh] flex-col overflow-hidden border-l border-border bg-muted/30">
          <PanelHeader tasks={tasks} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PanelBody {...props} />
          </div>
        </div>
      </aside>

      {/* Phones: a progress pill opening a bottom sheet. The shell is
          overflow-hidden, so the sheet owns its own scroller. */}
      {hasTeam && (
        <div className="md:hidden">
          <button
            type="button"
            onClick={() => setSheetOpen((v) => !v)}
            aria-expanded={sheetOpen}
            className="fixed bottom-[calc(80px+env(safe-area-inset-bottom))] left-1/2 z-40 flex min-h-10 -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[12px]"
          >
            <ChevronUp className={`h-3.5 w-3.5 transition-transform ${sheetOpen ? 'rotate-180' : ''}`} />
            <span className="tabular-nums">
              {done}/{total}
              {running > 0 ? ` · ${running} running` : ''}
            </span>
          </button>
          {sheetOpen && (
            <div className="fixed inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] z-40 max-h-[60dvh] overflow-y-auto rounded-t-[10px] border-t border-border bg-background shadow-lg">
              <div className="sticky top-0 z-10 bg-background">
                <div className="flex justify-center pb-0.5 pt-2" aria-hidden>
                  <span className="h-1 w-10 rounded bg-border-strong" />
                </div>
                <PanelHeader tasks={tasks} onClose={() => setSheetOpen(false)} />
              </div>
              <PanelBody {...props} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

export { ElapsedTime };
export default memo(PlanPanel);
