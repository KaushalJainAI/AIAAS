/**
 * The messages the agent is holding before they go out, one row each, with
 * Cancel and Send now while they can still be stopped. Shown above the chat
 * composer and at the top of a run's page.
 *
 * Props only: the list, the clock and the callbacks come from
 * `usePendingSends`. A finished row (sent, cancelled, not sent) stays for two
 * minutes, then is hidden, so the outcome is seen and then gets out of the way.
 */
import { useEffect, useState } from 'react';
import { Mail, MessageSquare } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { HoldStatus } from '@/api/messaging';

/** How long a finished row stays on screen. */
export const SETTLED_VISIBLE_MS = 120_000;

/** One hold as the list shows it. `fetchedAt` and `settledAt` are client clock times. */
export interface PendingSendItem {
  id: number;
  tool: string;
  label: string;
  status: HoldStatus;
  send_at: string;
  error: string;
  seconds_left: number;
  fetchedAt: number;
  settledAt?: number;
}

interface PendingSendsProps {
  holds: PendingSendItem[];
  onCancel: (id: number) => void;
  onSendNow: (id: number) => void;
}

const clock = (total: number): string => {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

/** Seconds left, counted down from the server's figure at the time it was read. */
const left = (hold: PendingSendItem, now: number): number =>
  Math.max(0, hold.seconds_left - Math.floor((now - hold.fetchedAt) / 1000));

/** The line under the label, and its colour. */
function describe(hold: PendingSendItem, now: number): { text: string; tone: string } {
  switch (hold.status) {
    case 'held': {
      const seconds = left(hold, now);
      return {
        text: seconds > 0 ? `Sends in ${clock(seconds)}` : 'Sending now…',
        tone: 'text-muted-foreground',
      };
    }
    case 'sending':
      return { text: 'Sending…', tone: 'text-muted-foreground' };
    case 'sent':
      return { text: 'Sent ✓', tone: 'text-success' };
    case 'cancelled':
      return { text: 'Cancelled', tone: 'text-muted-foreground' };
    case 'failed':
      return {
        text: hold.error ? `Not sent: ${hold.error}` : 'Not sent',
        tone: 'text-destructive',
      };
    case 'unknown':
      return { text: 'Might not have been sent', tone: 'text-warning' };
  }
}

export default function PendingSends({ holds, onCancel, onSendNow }: PendingSendsProps) {
  // A clock for the countdowns. It only runs while there is a row to count.
  const [now, setNow] = useState(() => Date.now());
  const counting = holds.length > 0;
  useEffect(() => {
    if (!counting) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [counting]);

  const visible = holds.filter((hold) => {
    const finished = hold.status !== 'held' && hold.status !== 'sending';
    if (!finished || hold.settledAt === undefined) return true;
    return now - hold.settledAt < SETTLED_VISIBLE_MS;
  });

  return (
    <section aria-label="Messages waiting to send" aria-live="polite" className="mb-3">
      {visible.length > 0 && (
        <ul className="space-y-2">
          {visible.map((hold) => {
            const { text, tone } = describe(hold, now);
            const Icon = hold.tool === 'gmail_send_message' ? Mail : MessageSquare;
            return (
              <li
                key={hold.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-card px-4 py-3 shadow-sm"
              >
                <Icon aria-hidden className="w-4 h-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate" title={hold.label}>
                    {hold.label}
                  </p>
                  <p className={cn('text-xs tabular-nums', tone)}>{text}</p>
                </div>
                {hold.status === 'held' && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onCancel(hold.id)}
                      className="min-h-11 md:min-h-8 px-3 rounded-md border border-border bg-card text-sm text-foreground hover:bg-muted/50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => onSendNow(hold.id)}
                      className="min-h-11 md:min-h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
                    >
                      Send now
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
