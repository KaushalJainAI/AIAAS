/**
 * Scheduled — upcoming work and whether anything will actually fire.
 *
 * Read-only here; Schedules stays the editor. Reuses the existing trigger
 * list + scheduler health + missions list — no new endpoint. Hidden when
 * there is nothing scheduled and the scheduler is healthy.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Play } from 'lucide-react';
import { toast } from 'sonner';
import triggersService, { type Trigger } from '../../api/triggers';
import missionsService from '../../api/missions';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { when } from './bits';

function UpcomingRow({ trigger }: { trigger: Trigger }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const runNow = useMutation({
    mutationFn: () => triggersService.runNow(trigger.id),
    onSuccess: (result) => {
      setConfirming(false);
      queryClient.invalidateQueries({ queryKey: ['triggers'] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      if (result.execution_id) {
        toast.success(`Started — outcome: ${result.outcome}.`, {
          action: { label: 'Open run', onClick: () => { window.location.href = `/runs?run=${result.execution_id}`; } },
        });
      } else {
        toast.success(`Outcome: ${result.outcome}.`);
      }
    },
    onError: () => {
      setConfirming(false);
      toast.error('Could not fire that schedule.');
    },
  });

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium truncate">
          {trigger.name || trigger.goal || trigger.agent_name}
        </p>
        <p className="text-[11px] text-muted-foreground truncate">
          {trigger.agent_name}
          {trigger.description && ` · ${trigger.description}`}
          {trigger.next_due_at && ` · next ${when(trigger.next_due_at)}`}
          {trigger.queued_for && ' · one firing queued'}
        </p>
        {trigger.status !== 'ok' && trigger.status_message && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 truncate" title={trigger.status_message}>
            {trigger.status_message}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title="Fire this schedule now, through the sweep's own gates"
        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] rounded border border-border hover:bg-secondary shrink-0"
      >
        <Play className="w-3 h-3" />
        Run now
      </button>
      {confirming && (
        <ConfirmDialog
          title="Fire this schedule now?"
          body={`"${trigger.name || trigger.goal || trigger.agent_name}" runs through the sweep's own gates. A manual firing is extra — the next slot does not move.`}
          confirmLabel="Fire now"
          busy={runNow.isPending}
          onConfirm={() => runNow.mutate()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

export default function ScheduledSection() {
  const { data: triggers = [], isLoading } = useQuery({
    queryKey: ['triggers'],
    queryFn: () => triggersService.list(),
    staleTime: 30 * 1000,
  });
  const { data: health } = useQuery({
    queryKey: ['triggers', 'health'],
    queryFn: () => triggersService.health(),
    staleTime: 30 * 1000,
    refetchInterval: 60_000,
  });
  const { data: missions = [] } = useQuery({
    queryKey: ['missions'],
    queryFn: missionsService.list,
    staleTime: 15 * 1000,
  });

  const upcoming = triggers
    .filter((t) => t.mode === 'schedule' && t.enabled && t.next_due_at)
    .sort((a, b) => (a.next_due_at! < b.next_due_at! ? -1 : 1))
    .slice(0, 10);
  const waiting = missions
    .filter((m) => m.status === 'waiting' || m.status === 'active')
    .filter((m) => m.next_wake_at)
    .sort((a, b) => (a.next_wake_at! < b.next_wake_at! ? -1 : 1))
    .slice(0, 5);
  const schedulerDown = health && !health.running;

  if (!isLoading && upcoming.length === 0 && waiting.length === 0 && !schedulerDown) return null;

  return (
    <section className="mb-4 border border-border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <CalendarClock className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Scheduled</h2>
        <span className="text-[12px] text-muted-foreground">
          {isLoading ? 'Loading…' : `${upcoming.length} upcoming`}
        </span>
        <Link to="/schedules" className="ml-auto text-[12px] text-primary hover:underline">
          Edit schedules
        </Link>
      </div>
      {schedulerDown && (
        <p className="px-4 py-2 text-[12px] text-destructive bg-destructive-subtle border-b border-border">
          The scheduler is not running — schedules will not fire until it checks in again.
        </p>
      )}
      {upcoming.map((t) => (
        <UpcomingRow key={t.id} trigger={t} />
      ))}
      {waiting.map((m) => (
        <div key={`mission-${m.id}`} className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-b-0">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium truncate" title={m.goal}>{m.goal}</p>
            <p className="text-[11px] text-muted-foreground">
              Mission · wakes {m.next_wake_at ? when(m.next_wake_at) : 'soon'}
            </p>
          </div>
        </div>
      ))}
    </section>
  );
}
