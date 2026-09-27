import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlarmClock, Mail, Repeat, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
  notificationsService,
  type ScheduledReminder,
} from '../../api/notifications';
import { ConfirmDialog } from '../ui/ConfirmDialog';

const REPEAT_LABEL: Record<ScheduledReminder['repeat'], string> = {
  none: 'Once',
  hourly: 'Hourly',
  daily: 'Daily',
  weekly: 'Weekly',
};

/**
 * Live user-asked reminders, managed outside chat.
 *
 * Fired rows land in "Recent notifications" below; this is the standing
 * half — what is scheduled, when each fires next, whether it repeats, and
 * a way out. Creation stays conversational (the tool quotes the user's own
 * timing), so there is deliberately no "new" button here: a form asking for
 * a datetime would re-ask what chat already parses.
 */
export default function ScheduledReminders() {
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState<ScheduledReminder | null>(null);

  const { data: reminders = [], isLoading } = useQuery({
    queryKey: ['notifications', 'scheduled'],
    queryFn: notificationsService.listScheduled,
    staleTime: 15 * 1000,
    refetchInterval: 60 * 1000,
  });

  const cancel = useMutation({
    mutationFn: (id: number) => notificationsService.cancelScheduled(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', 'scheduled'] });
      setCancelling(null);
    },
    onError: (error: unknown) => {
      /* A one-time reminder can fire between list load and confirm: the row
         is gone, so the cancel answers 404. Close the dialog, refresh the
         list, and say what happened — otherwise the dialog sits open over a
         stale list with nothing shown. Any other failure closes it too: the
         list refresh is what tells the user whether the cancel landed. */
      const status = (error as { response?: { status?: number } })
        ?.response?.status;
      queryClient.invalidateQueries({ queryKey: ['notifications', 'scheduled'] });
      setCancelling(null);
      toast.error(
        status === 404
          ? 'That reminder already fired or was removed.'
          : 'Could not cancel that reminder.',
      );
    },
  });

  if (isLoading) {
    return <div className="h-16 rounded-lg bg-card border border-border/60 animate-pulse" />;
  }

  return (
    <div>
      <h3 className="text-lg font-medium">Scheduled reminders</h3>
      <p className="text-sm text-muted-foreground mt-1">
        At-a-time and heartbeat reminders you asked for. Ask in chat to add one —
        “remind me tomorrow at 9am”, “ping me hourly while the migration runs”.
      </p>

      {reminders.length === 0 ? (
        <div className="mt-4 text-center py-8 border border-dashed border-border/60 rounded-lg bg-card/30">
          <AlarmClock className="w-6 h-6 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="text-sm text-muted-foreground font-medium">No reminders scheduled</p>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {reminders.map((reminder) => (
            <div
              key={reminder.id}
              className="p-3 rounded-lg border border-border/60 bg-card/60 flex gap-3 items-start"
            >
              <div className="mt-0.5 shrink-0 p-1.5 bg-background rounded-full border border-border/50">
                <AlarmClock className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{reminder.title}</p>
                <p className="text-[12px] text-muted-foreground truncate">
                  {reminder.message}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground/80">
                    {formatDistanceToNow(new Date(reminder.next_run_at), { addSuffix: true })}
                  </span>
                  {reminder.repeat !== 'none' && (
                    <span className="inline-flex items-center gap-1">
                      <Repeat className="w-3 h-3" />
                      {REPEAT_LABEL[reminder.repeat]}
                      {reminder.times_sent > 0 && ` · sent ${reminder.times_sent}x`}
                    </span>
                  )}
                  {reminder.send_email && (
                    <span className="inline-flex items-center gap-1">
                      <Mail className="w-3 h-3" />
                      Email too
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCancelling(reminder)}
                title="Cancel this reminder"
                aria-label={`Cancel ${reminder.title}`}
                className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {cancelling && (
        <ConfirmDialog
          title={`Cancel "${cancelling.title}"?`}
          body={
            cancelling.repeat === 'none'
              ? 'It will never fire.'
              : 'The heartbeat stops. Already-fired notifications stay in the list below.'
          }
          confirmLabel="Cancel reminder"
          busy={cancel.isPending}
          onConfirm={() => cancel.mutate(cancelling.id)}
          onCancel={() => setCancelling(null)}
        />
      )}
    </div>
  );
}
