import { memo, useEffect, useState } from 'react';
import {
  Check,
  ChevronUp,
  GitBranch,
  Lock,
  Send,
  Square,
} from 'lucide-react';
import agentsService from '../../api/agents';
import type { TodoItem } from '../../api/chat';
import PlanView from '../plan/PlanView';
import { planProgress, type PlanChange, type PlanLease, type PlanTask } from '../../lib/planStream';
import { apiErrorMessage } from '../../lib/apiError';
import { toast } from 'sonner';

/**
 * The coding team's side panel, OpenCode-style: the lead's plan on top, one
 * live lane per worker, locks and recent changes below.
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
  return <span className="tabular-nums text-muted-foreground">{mm}:{ss}</span>;
}

const LANE_STATUS: Record<string, { label: string; className: string }> = {
  running: { label: 'running', className: 'text-primary' },
  paused: { label: 'paused for approval', className: 'text-amber-500' },
  done: { label: 'done', className: 'text-emerald-500' },
  failed: { label: 'failed', className: 'text-destructive' },
  cancelled: { label: 'stopped', className: 'text-muted-foreground' },
};

function WorkerLane({ task, readOnly }: { task: PlanTask; readOnly: boolean }) {
  const [steerOpen, setSteerOpen] = useState(false);
  const [steerText, setSteerText] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [autonomy, setAutonomy] = useState('');
  const live = task.status === 'running' || task.status === 'paused';
  const status = LANE_STATUS[task.status] ?? LANE_STATUS.running;

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
    <div className="rounded-lg border border-border/60 bg-card/50 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-[12px] font-medium">{task.title || task.task_id}</span>
        <span className={`ml-auto shrink-0 text-[11px] ${status.className}`}>{status.label}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">
          {task.label}
          {task.claims[0] ? ` · ${task.claims[0]}` : ''}
        </span>
        {live && <ElapsedTime since={task.started_at_ms} />}
        {task.tokens > 0 && <span className="ml-auto shrink-0 tabular-nums">{task.tokens} tok</span>}
      </div>

      {!readOnly && live && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            onClick={() => setSteerOpen((v) => !v)}
            className="rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-secondary"
            title="Send an instruction to this worker"
          >
            Steer
          </button>
          <select
            value={autonomy}
            onChange={(e) => switchAutonomy(e.target.value)}
            disabled={busy}
            className="rounded border border-border bg-transparent px-1 py-0.5 text-[11px] text-muted-foreground"
            title="How much this worker asks"
          >
            <option value="">Ask…</option>
            <option value="review">Review</option>
            <option value="ask">Ask</option>
            <option value="auto">Auto</option>
            <option value="full">Full</option>
          </select>
          <button
            onClick={stop}
            disabled={busy}
            className={`ml-auto flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] hover:bg-secondary ${
              confirmStop ? 'border-destructive text-destructive' : 'border-border'
            }`}
            title="Stop this worker (its changes stay)"
          >
            <Square className="h-2.5 w-2.5" />
            {confirmStop ? 'Confirm' : 'Stop'}
          </button>
          {task.execution_id && (
            <a
              href={`/runs/${task.execution_id}`}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-secondary"
              title="Open this worker's run"
            >
              Open run
            </a>
          )}
        </div>
      )}

      {steerOpen && !readOnly && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            value={steerText}
            onChange={(e) => setSteerText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') sendSteer();
            }}
            placeholder={`Steer ${task.label}…`}
            className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-1 text-[12px]"
          />
          <button
            onClick={sendSteer}
            disabled={busy || !steerText.trim()}
            className="rounded border border-border p-1 hover:bg-secondary disabled:opacity-50"
            title="Send"
          >
            <Send className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function PanelBody({ todos, todoHistory, tasks, leases, changes, readOnly }: Props) {
  const { done, total, running } = planProgress(tasks);
  const showPlan = todos.length > 0;
  const showTasks = tasks.length > 0;

  if (!showPlan && !showTasks && leases.length === 0 && changes.length === 0) {
    return <p className="px-3 py-4 text-[12px] text-muted-foreground">No team task running.</p>;
  }

  return (
    <div className="space-y-3 p-2.5">
      {showPlan && (
        <section>
          <div className="mb-1 flex items-center gap-2 px-1">
            <span className="text-[11px] font-medium text-muted-foreground">Plan</span>
            {showTasks && (
              <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                {done}/{total} done{running > 0 ? ` · ${running} running` : ''}
              </span>
            )}
          </div>
          {/* The same component as the dock and saved replies, so a team
              run shows dropped steps, reasons and history the same way. */}
          <div className="overflow-hidden rounded-md border border-border/60">
            <PlanView history={todoHistory?.length ? todoHistory : [todos]} bare />
          </div>
        </section>
      )}

      {showTasks && (
        <section className="space-y-1.5">
          <div className="px-1 text-[11px] font-medium text-muted-foreground">Workers</div>
          {tasks.map((t) => (
            <WorkerLane key={t.handle} task={t} readOnly={!!readOnly} />
          ))}
        </section>
      )}

      {(leases.length > 0 || changes.length > 0) && (
        <section>
          <div className="mb-1 px-1 text-[11px] font-medium text-muted-foreground">Locks & changes</div>
          <ul className="m-0 list-none space-y-0.5 p-0">
            {leases.map((l) => (
              <li key={l.pattern} className="flex items-center gap-1.5 px-1 py-0.5 text-[12px]">
                <Lock className="h-3 w-3 shrink-0 text-amber-500" />
                <span className="truncate font-mono text-[11px]">{l.pattern}</span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{l.holder_label}</span>
              </li>
            ))}
            {changes.slice(0, 8).map((c, i) => (
              <li key={`${c.path}-${i}`} className="flex items-center gap-1.5 px-1 py-0.5 text-[12px]">
                <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                <span className="truncate font-mono text-[11px]">{c.path}</span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{c.by_label}</span>
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
      {/* Desktop: sticky right rail. */}
      <aside className="hidden w-72 shrink-0 md:block">
        <div className="sticky top-4 max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-lg border border-border/60 bg-background">
          <PanelBody {...props} />
        </div>
      </aside>

      {/* Phones: a progress pill opening a bottom sheet. The shell is
          overflow-hidden, so the sheet owns its own scroller. */}
      {hasTeam && (
        <div className="md:hidden">
          <button
            onClick={() => setSheetOpen((v) => !v)}
            className="fixed bottom-[calc(80px+env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-1.5 text-[12px] shadow-lg"
          >
            <ChevronUp className={`h-3.5 w-3.5 transition-transform ${sheetOpen ? 'rotate-180' : ''}`} />
            <span className="tabular-nums">
              {done}/{total}
              {running > 0 ? ` · ${running} running` : ''}
            </span>
          </button>
          {sheetOpen && (
            <div className="fixed inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] z-40 max-h-[60dvh] overflow-y-auto rounded-t-xl border-t border-border bg-background shadow-2xl">
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
