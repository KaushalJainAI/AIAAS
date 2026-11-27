/**
 * Recently finished — what ended in the last day, under "Running now".
 *
 * Agent runs (delegated workers included) and each chat's latest reply, newest
 * first. A worker that finished after the chat turn that started it used to be
 * findable only in History; here it sits next to the chat it worked for, with
 * its outcome, so "it stopped showing as running" always has an answer (H-185).
 * Hidden when empty.
 */
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { ACTIVITY_RECENT_KEY, useActivityLive, useActivityRecent } from '../../hooks/useActivityLive';
import type { RecentItem } from '../../api/activity';
import { kindLabel } from '../../lib/activity';
import { cn } from '../../lib/utils';
import { StatusDot, when } from './bits';

/** Chat statuses as words; runs use the shared status dot. */
function ChatStatus({ status }: { status: string }) {
  const tone = status === 'stopped' ? 'text-warning'
    : status === 'waiting on you' ? 'text-warning'
      : 'text-muted-foreground';
  return <span className={cn('text-[12px] whitespace-nowrap capitalize', tone)}>{status}</span>;
}

function RecentRow({ item }: { item: RecentItem }) {
  const plan = (item.plan_total ?? 0) > 0 ? ` · plan ${item.plan_done}/${item.plan_total}` : '';
  return (
    <Link
      to={item.href}
      className="flex min-h-11 items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0 hover:bg-secondary"
    >
      <span className="inline-flex shrink-0 items-center rounded border border-border bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
        {kindLabel(item.kind)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium" title={item.title}>{item.title}</p>
        <p className="truncate text-[11px] text-muted-foreground" title={item.error || item.detail}>
          <span className="font-mono tabular-nums">{item.ended_at ? when(item.ended_at) : ''}</span>
          {item.is_delegated && ' · started from chat'}
          {plan}
          {(item.error || item.detail) && ` · ${item.error || item.detail}`}
        </p>
      </div>
      {item.kind === 'agent_run' ? <StatusDot status={item.status} /> : <ChatStatus status={item.status} />}
    </Link>
  );
}

export default function RecentList() {
  const { items, truncated, hours } = useActivityRecent();
  const { items: live } = useActivityLive();
  const queryClient = useQueryClient();
  // Something left "Running now": it belongs here now, so read again at once
  // rather than at the next slow poll.
  const liveCount = useRef(live.length);
  useEffect(() => {
    if (live.length < liveCount.current) {
      queryClient.invalidateQueries({ queryKey: ACTIVITY_RECENT_KEY });
    }
    liveCount.current = live.length;
  }, [live.length, queryClient]);

  if (items.length === 0) return null;

  return (
    <section className="mb-4 overflow-hidden rounded-md border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <History className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-[13px] font-semibold text-muted-foreground">Recently finished</h2>
        <span className="text-[12px] tabular-nums text-muted-foreground">
          last {hours} h · {items.length}{truncated && '+'}
        </span>
      </div>
      <div className={cn(items.length > 8 && 'max-h-[460px] overflow-y-auto')}>
        {items.map((item) => (
          <RecentRow key={`${item.kind}:${item.id}:${item.ended_at}`} item={item} />
        ))}
      </div>
    </section>
  );
}
