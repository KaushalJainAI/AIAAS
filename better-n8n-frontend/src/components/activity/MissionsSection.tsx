/**
 * Missions on the Activity page — read-only goals with Cancel/Delete only.
 *
 * Decision A of the Activity plan: the sweep that moves missions forward does
 * not run in production (it would block a web thread for up to two hours), so
 * this page offers no create form and no pause/resume. A mission is a chain of
 * runs; the rows below already show its links badged with the mission id. This
 * section owns the goal itself — plan progress, spend vs budget, next wake,
 * cancel, delete — and turns back into the full section once missions can run.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Clock, Loader2, Target, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import missionsService, { type Mission } from '../../api/missions';
import { ConfirmDialog } from '../ui/ConfirmDialog';

const MISSION_STATUS_STYLE: Record<Mission['status'], string> = {
  active: 'border-agent-line bg-agent-subtle text-agent',
  waiting: 'border-primary-line bg-primary-subtle text-primary',
  paused: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  done: 'border-border bg-secondary text-muted-foreground',
  failed: 'border-destructive/40 bg-destructive/10 text-destructive',
  cancelled: 'border-border bg-secondary text-muted-foreground',
};

function MissionCard({
  mission,
  expanded,
  onToggle,
  onCancel,
  onDelete,
  busy,
}: {
  mission: Mission;
  expanded: boolean;
  onToggle: () => void;
  onCancel: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const live = mission.status === 'active' || mission.status === 'waiting' || mission.status === 'paused';
  const todos = mission.total_todos
    ? `${(mission.total_todos ?? 0) - (mission.open_todos ?? 0)}/${mission.total_todos} steps`
    : null;

  return (
    <div className="bg-card border border-border rounded flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        className="p-4 flex items-start gap-3 text-left w-full"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-semibold capitalize',
                MISSION_STATUS_STYLE[mission.status],
              )}
            >
              {mission.status}
            </span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {mission.runs_done}/{mission.max_runs} runs · ₹{mission.spent_inr.toLocaleString('en-IN')} of ₹
              {mission.budget_inr.toLocaleString('en-IN')}
            </span>
            {todos && (
              <span className="text-[11px] text-muted-foreground tabular-nums">{todos}</span>
            )}
          </div>
          <p className="font-medium text-[14px] mt-1.5 leading-snug">{mission.goal}</p>
          {mission.next_wake_at && live && (
            <p className="text-[12px] text-muted-foreground mt-1 inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Next wake {new Date(mission.next_wake_at).toLocaleString()}
            </p>
          )}
        </div>
        <ChevronDown
          className={cn('w-4 h-4 text-muted-foreground shrink-0 mt-1 transition-transform', expanded && 'rotate-180')}
        />
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {mission.plan && mission.plan.length > 0 && (
            <ul className="space-y-1">
              {mission.plan.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px]">
                  {step.status === 'done' ? (
                    <Check className="w-3.5 h-3.5 mt-0.5 text-agent shrink-0" />
                  ) : (
                    <span className="w-3.5 h-3.5 mt-0.5 rounded-full border border-border shrink-0" />
                  )}
                  <span className={step.status === 'done' ? 'text-muted-foreground line-through' : ''}>
                    {step.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {mission.last_report && (
            <p className="text-[13px] text-muted-foreground leading-relaxed border-l-2 border-border pl-3">
              {mission.last_report}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {live && (
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card text-[12px] font-semibold text-destructive hover:bg-secondary disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
            )}
            {!live && (
              <button
                type="button"
                onClick={onDelete}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card text-[12px] font-semibold text-muted-foreground hover:bg-secondary disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" />
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MissionsSection() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState<Mission | null>(null);
  const [deleting, setDeleting] = useState<Mission | null>(null);
  const [showFinished, setShowFinished] = useState(false);

  const { data: missions = [], isLoading, isError } = useQuery({
    queryKey: ['missions'],
    queryFn: missionsService.list,
    staleTime: 15 * 1000,
    refetchInterval: 30_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['missions'] });
  };

  const cancel = useMutation({
    mutationFn: (mission: Mission) => missionsService.cancel(mission.id),
    onSuccess: () => {
      invalidate();
      setCancelling(null);
      toast.success('Mission cancelled.');
    },
    onError: (error: unknown) => {
      const detail = (error as { response?: { data?: { error?: string } } })
        ?.response?.data?.error;
      toast.error(detail || 'That did not work.');
      setCancelling(null);
    },
  });

  const remove = useMutation({
    mutationFn: (mission: Mission) => missionsService.remove(mission.id),
    onSuccess: () => {
      invalidate();
      setDeleting(null);
      toast.success('Mission deleted. Past runs stay in the list below.');
    },
    onError: (error: unknown) => {
      const detail = (error as { response?: { data?: { error?: string } } })
        ?.response?.data?.error;
      toast.error(detail || 'That did not work.');
      setDeleting(null);
    },
  });

  const live = useMemo(
    () => missions.filter((m) => m.status === 'active' || m.status === 'waiting' || m.status === 'paused'),
    [missions],
  );
  const done = useMemo(
    () => missions.filter((m) => !['active', 'waiting', 'paused'].includes(m.status)),
    [missions],
  );

  if (!isLoading && !isError && missions.length === 0) return null;

  return (
    <section className="mb-4 border border-border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Target className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Missions</h2>
        <span className="text-[12px] text-muted-foreground">
          {isLoading ? 'Loading…' : `${live.length} live · ${done.length} finished`}
        </span>
      </div>
      <div className="p-4 space-y-3 bg-bg-1">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        ) : isError ? (
          <p className="text-[13px] text-destructive">
            Could not load missions. Reload the page to try again.
          </p>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              {live.map((m) => (
                <MissionCard
                  key={m.id}
                  mission={m}
                  expanded={expandedId === m.id}
                  onToggle={() => setExpandedId((id) => (id === m.id ? null : m.id))}
                  onCancel={() => setCancelling(m)}
                  onDelete={() => setDeleting(m)}
                  busy={cancel.isPending || remove.isPending}
                />
              ))}
            </div>
            {done.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowFinished((v) => !v)}
                  className="text-[12px] font-semibold text-muted-foreground hover:text-foreground"
                >
                  {showFinished ? 'Hide finished' : `Show finished (${done.length})`}
                </button>
                {showFinished && (
                  <div className="grid gap-3 md:grid-cols-2 mt-3">
                    {done.map((m) => (
                      <MissionCard
                        key={m.id}
                        mission={m}
                        expanded={expandedId === m.id}
                        onToggle={() => setExpandedId((id) => (id === m.id ? null : m.id))}
                        onCancel={() => setCancelling(m)}
                        onDelete={() => setDeleting(m)}
                        busy={cancel.isPending || remove.isPending}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {cancelling && (
        <ConfirmDialog
          title="Cancel this mission?"
          body={`"${cancelling.goal}" stops for good. Past runs stay below in the run list.`}
          confirmLabel="Cancel mission"
          busy={cancel.isPending}
          onConfirm={() => cancel.mutate(cancelling)}
          onCancel={() => setCancelling(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete this mission?"
          body={`"${deleting.goal}" goes away. Past runs stay below in the run list.`}
          confirmLabel="Delete mission"
          busy={remove.isPending}
          onConfirm={() => remove.mutate(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
