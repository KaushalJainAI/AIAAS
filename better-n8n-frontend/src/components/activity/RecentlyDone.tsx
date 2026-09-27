/**
 * Recently done — what schedules did lately, and whether it worked.
 *
 * Derived from the trigger rows' own outcome fields (`last_outcome`,
 * `last_error`, `last_fired_at`, `last_run_id`), newest first. The finished
 * runs themselves live in History below; this is the schedule's verdict, not
 * the run's trace. Hidden when nothing has fired yet.
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import triggersService from '../../api/triggers';
import { when } from './bits';
import { cn } from '../../lib/utils';

const OUTCOME_CLS: Record<string, string> = {
  fired: 'text-agent',
  queued: 'text-primary',
  waiting: 'text-primary',
  late: 'text-amber-600 dark:text-amber-400',
  skipped: 'text-muted-foreground',
  dropped: 'text-destructive',
  failed: 'text-destructive',
  refused: 'text-destructive',
  expired: 'text-muted-foreground',
  stopped: 'text-muted-foreground',
  busy: 'text-muted-foreground',
  paused: 'text-warning',
};

export default function RecentlyDone() {
  const { data: triggers = [], isLoading } = useQuery({
    queryKey: ['triggers'],
    queryFn: () => triggersService.list(),
    staleTime: 30 * 1000,
  });

  const done = triggers
    .filter((t) => t.last_fired_at)
    .sort((a, b) => ((a.last_fired_at ?? '') < (b.last_fired_at ?? '') ? 1 : -1))
    .slice(0, 8);

  if (!isLoading && done.length === 0) return null;

  return (
    <section className="mb-4 border border-border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <History className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Recently done</h2>
      </div>
      {done.map((t) => (
        <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-b-0">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium truncate">
              {t.name || t.goal || t.agent_name}
              <span className="font-normal text-muted-foreground"> · {t.agent_name}</span>
            </p>
            <p className="text-[11px] text-muted-foreground">
              {t.last_fired_at ? when(t.last_fired_at) : '—'}
              {t.last_outcome && (
                <span className={cn('font-semibold', OUTCOME_CLS[t.last_outcome] ?? '')}>
                  {` · ${t.last_outcome}`}
                </span>
              )}
              {t.last_error && (
                <span className="truncate" title={t.last_error}>{` — ${t.last_error}`}</span>
              )}
            </p>
          </div>
          {t.last_run_id && (
            <Link
              to={`/runs?run=${t.last_run_id}`}
              className="px-2.5 py-1.5 text-[12px] rounded border border-border hover:bg-secondary shrink-0"
            >
              Open run
            </Link>
          )}
        </div>
      ))}
    </section>
  );
}
