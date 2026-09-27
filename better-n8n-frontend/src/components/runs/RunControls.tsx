/**
 * What a person can do to a run that is still going.
 *
 * Every control here had a backend and no caller: `runs/{id}/cancel/` (new),
 * `agents/{id}/steer/` and `agents/{id}/autonomy/`. Approve and reject are not
 * repeated here on purpose — the Activity page answers a paused run through
 * the same functions `agent_approve` uses, and a second answering screen is
 * a second place for the two to drift. A paused run links there instead.
 *
 * Steer and autonomy address the agent's *latest* running run, because that is
 * how the endpoints key their mailbox. When that is not the run on screen, the
 * reply says so rather than letting an instruction land somewhere unseen.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Square, Send, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import agentsService from '../../api/agents';
import { cn } from '../../lib/utils';

type Level = 'review' | 'ask' | 'auto' | 'full';

const LEVELS: { id: Level; label: string; hint: string }[] = [
  { id: 'review', label: 'Review', hint: 'Ask before every step' },
  { id: 'ask', label: 'Ask', hint: 'Ask before anything leaves the account' },
  { id: 'auto', label: 'Auto', hint: 'Only ask before permanent changes' },
  { id: 'full', label: 'Full', hint: 'Never ask' },
];

function errorText(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { error?: string } } }).response?.data;
  return data?.error ?? fallback;
}

export default function RunControls({ executionId, agentId, status }: {
  executionId: string;
  agentId: number | null;
  status: string;
}) {
  const queryClient = useQueryClient();
  const [stopping, setStopping] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['run', executionId] });
    queryClient.invalidateQueries({ queryKey: ['runs'] });
  };

  const stop = async () => {
    setStopping(true);
    try {
      const result = await agentsService.cancelRun(executionId);
      toast.success(result.status === 'cancelled' ? 'Run stopped' : `Run already ${result.status}`);
      refresh();
    } catch (err) {
      toast.error(errorText(err, 'Could not stop the run.'));
    } finally {
      setStopping(false);
    }
  };

  const otherRunWarning = (landedOn: string) => {
    if (landedOn !== executionId) {
      toast.warning('That went to a newer run of this agent, not the one on screen.');
    }
  };

  const steer = async () => {
    if (!agentId || !message.trim()) return;
    setSending(true);
    try {
      const result = await agentsService.steer(agentId, message.trim());
      setMessage('');
      otherRunWarning(result.execution_id);
      // `dropped` is non-zero only when the mailbox overflowed — an
      // instruction someone believes was accepted and that vanished is the
      // failure the queue exists to prevent, so it is said out loud.
      if (result.dropped > 0) {
        toast.warning(`Queued — but ${result.dropped} older instruction(s) were dropped.`);
      } else {
        toast.success('Sent — the agent reads it at its next step.');
      }
    } catch (err) {
      toast.error(errorText(err, 'Could not send that.'));
    } finally {
      setSending(false);
    }
  };

  const setLevel = async (level: Level) => {
    if (!agentId) return;
    try {
      const result = await agentsService.setRunAutonomy(agentId, level);
      otherRunWarning(result.execution_id);
      toast.success(`Autonomy is ${level} for the rest of this run`);
    } catch (err) {
      toast.error(errorText(err, 'Could not change that.'));
    }
  };

  const paused = status === 'paused';

  return (
    <div className="mb-3 p-3 rounded border border-border bg-card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {paused && (
          <Link to="/runs"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-primary text-primary-foreground text-[13px] font-semibold">
            <Inbox className="w-3.5 h-3.5" />
            Answer it
          </Link>
        )}
        <button type="button" onClick={stop} disabled={stopping}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded border border-border text-[13px] text-destructive hover:bg-destructive-subtle disabled:opacity-50">
          <Square className="w-3.5 h-3.5" />
          {stopping ? 'Stopping…' : 'Stop run'}
        </button>
        {!paused && agentId != null && (
          <div className="flex items-center gap-1 ml-auto" role="group" aria-label="Autonomy for the rest of this run">
            <span className="text-[12px] text-muted-foreground mr-1">Autonomy</span>
            {LEVELS.map((l) => (
              <button key={l.id} type="button" title={l.hint}
                onClick={() => setLevel(l.id)}
                className={cn('h-7 px-2 rounded border text-[12px]',
                  'border-input text-muted-foreground hover:text-foreground')}>
                {l.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {!paused && agentId != null && (
        <div className="flex gap-2">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void steer(); }}
            placeholder="Tell it something mid-run, e.g. “also check the pricing page”"
            className="flex-1 h-8 px-3 rounded border border-input bg-background text-[13px]"
          />
          <button type="button" onClick={steer} disabled={sending || !message.trim()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded border border-border text-[13px] hover:bg-secondary disabled:opacity-50">
            <Send className="w-3.5 h-3.5" />
            Send
          </button>
        </div>
      )}
    </div>
  );
}
