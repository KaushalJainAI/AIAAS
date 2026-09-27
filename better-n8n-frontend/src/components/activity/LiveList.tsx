/**
 * Running now — one list of every live process, whatever its kind.
 *
 * Each row shows only the controls the backend actually supports: the server
 * computes `actions` per row, and unknown verbs are dropped in
 * `lib/activity.ts` rather than rendered as buttons that 409. Polls every 5s
 * only while the list is non-empty; hidden entirely when empty.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { useActivityLive } from '../../hooks/useActivityLive';
import { kindLabel, visibleActions } from '../../lib/activity';
import type { LiveItem } from '../../api/activity';
import agentsService from '../../api/agents';
import evalsService from '../../api/evals';
import { chatService, logsService } from '../../api';
import { cn } from '../../lib/utils';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { StatusPill, elapsed, when } from './bits';

function errorText(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { error?: string } } }).response?.data;
  return data?.error ?? fallback;
}

function LiveRow({ item }: { item: LiveItem }) {
  const queryClient = useQueryClient();
  const [steering, setSteering] = useState(false);
  const [message, setMessage] = useState('');
  const [marking, setMarking] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['activity', 'live'] });
    queryClient.invalidateQueries({ queryKey: ['runs'] });
  };

  const stop = useMutation({
    mutationFn: async () => {
      if (item.kind === 'chat_turn') {
        await chatService.stopStream(item.id);
        return;
      }
      if (item.kind === 'eval_sweep') {
        await evalsService.cancelRun(item.id);
        return;
      }
      await agentsService.cancelRun(item.id);
    },
    onSuccess: () => {
      toast.success('Stopped.');
      refresh();
    },
    onError: (err) => toast.error(errorText(err, 'Could not stop it.')),
  });

  const steer = useMutation({
    mutationFn: (text: string) => agentsService.steerRun(item.id, text),
    onSuccess: () => {
      toast.success('Steer sent.');
      setMessage('');
      setSteering(false);
      refresh();
    },
    onError: (err) => toast.error(errorText(err, 'Could not steer it.')),
  });

  const markFailed = useMutation({
    mutationFn: () => logsService.markExecutionFailed(item.id),
    onSuccess: () => {
      toast.success('Marked as failed.');
      setMarking(false);
      refresh();
    },
    onError: (err) => toast.error(errorText(err, 'Could not mark it failed.')),
  });

  const actions = visibleActions(item);

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-b-0">
      <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-border bg-secondary text-[11px] font-semibold text-muted-foreground shrink-0">
        {kindLabel(item.kind)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium truncate" title={item.title}>{item.title}</p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {item.started_at ? when(item.started_at) : `running ${elapsed(item.elapsed_s)}`}
          {item.elapsed_s != null && item.started_at ? ` · ${elapsed(item.elapsed_s)} elapsed` : ''}
          {item.spend_rupees != null && item.spend_rupees > 0 && ` · ₹${item.spend_rupees.toLocaleString('en-IN')}`}
          {item.is_delegated && ' · by another agent'}
          {item.stuck && <span className="text-destructive font-semibold"> · stuck past its run limit</span>}
        </p>
      </div>
      {item.kind === 'agent_run'
        ? <StatusPill status={item.status} />
        : <span className="text-[11px] text-muted-foreground capitalize shrink-0">{item.status}</span>}
      <div className="flex items-center gap-1.5 shrink-0">
        {actions.map(({ id, label }) => {
          if (id === 'open') {
            return (
              <Link
                key={id}
                to={item.href}
                className="px-2.5 py-1.5 text-[12px] rounded border border-border hover:bg-secondary"
              >
                {label}
              </Link>
            );
          }
          if (id === 'steer') {
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSteering((v) => !v)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] rounded border border-border hover:bg-secondary"
              >
                <Send className="w-3 h-3" />
                {label}
              </button>
            );
          }
          if (id === 'mark_failed') {
            return (
              <button
                key={id}
                type="button"
                onClick={() => setMarking(true)}
                className="px-2.5 py-1.5 text-[12px] rounded border border-destructive/40 text-destructive hover:bg-secondary"
              >
                {label}
              </button>
            );
          }
          return (
            <button
              key={id}
              type="button"
              disabled={stop.isPending}
              onClick={() => stop.mutate()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] rounded border border-border hover:bg-secondary disabled:opacity-50"
            >
              <X className="w-3 h-3" />
              {label}
            </button>
          );
        })}
      </div>
      {steering && (
        <form
          className="flex items-center gap-2 basis-full"
          onSubmit={(e) => {
            e.preventDefault();
            if (message.trim()) steer.mutate(message.trim());
          }}
        >
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Steer this worker…"
            className="flex-1 px-3 py-1.5 bg-background border border-border rounded text-[13px]"
          />
          <button
            type="submit"
            disabled={!message.trim() || steer.isPending}
            className="px-3 py-1.5 text-[12px] rounded bg-primary text-primary-foreground font-semibold disabled:opacity-50"
          >
            Send
          </button>
        </form>
      )}
      {marking && (
        <ConfirmDialog
          title="Mark this run as failed?"
          body={`"${item.title}" is past its run limit and looks stuck. This closes it as failed so it stops counting as live.`}
          confirmLabel="Mark as failed"
          busy={markFailed.isPending}
          onConfirm={() => markFailed.mutate()}
          onCancel={() => setMarking(false)}
        />
      )}
    </div>
  );
}

export default function LiveList() {
  const { items, truncated, note } = useActivityLive();

  if (items.length === 0) return null;

  return (
    <section className="mb-4 border border-border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Activity className="w-4 h-4 text-agent" />
        <h2 className="text-sm font-semibold">Running now</h2>
        <span className="text-[12px] text-muted-foreground tabular-nums">
          {items.length} live{truncated && '+'}
        </span>
      </div>
      <div className={cn(items.length > 6 && 'max-h-[380px] overflow-y-auto')}>
        {items.map((item) => (
          <LiveRow key={`${item.kind}:${item.id}`} item={item} />
        ))}
      </div>
      {note && (
        <p className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border">{note}</p>
      )}
    </section>
  );
}
