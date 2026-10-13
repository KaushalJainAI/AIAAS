/**
 * Shared bits for the Activity sections: status pill, durations, ages.
 *
 * One copy so the live list, the history list and the run detail cannot drift
 * into three different wordings for the same state.
 */
/* eslint-disable react-refresh/only-export-components */
// Shared display helpers live here on purpose so the three Activity sections
// cannot drift into three wordings for the same state.
import { CheckCircle2, CircleSlash, Clock, Hand, Loader2, XCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

const statusConfig = {
  completed: { icon: CheckCircle2, cls: 'text-success', bg: 'bg-success-subtle', label: 'Succeeded' },
  failed: { icon: XCircle, cls: 'text-destructive', bg: 'bg-destructive-subtle', label: 'Failed' },
  running: { icon: Loader2, cls: 'text-agent', bg: 'bg-agent-subtle', label: 'Running', spin: true },
  pending: { icon: Clock, cls: 'text-muted-foreground', bg: 'bg-secondary', label: 'Queued' },
  cancelled: { icon: CircleSlash, cls: 'text-muted-foreground', bg: 'bg-secondary', label: 'Cancelled' },
  // A run held for approval. It fell through to `pending` and read "Queued",
  // which says "wait" to the one person the run is waiting on.
  paused: { icon: Hand, cls: 'text-warning', bg: 'bg-warning-subtle', label: 'Needs you' },
} as const;

export function StatusPill({ status }: { status: string }) {
  const cfg = statusConfig[status as keyof typeof statusConfig] ?? statusConfig.pending;
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[12px] font-semibold', cfg.bg, cfg.cls)}>
      <Icon className={cn('w-3.5 h-3.5', 'spin' in cfg && cfg.spin && 'animate-spin')} />
      {cfg.label}
    </span>
  );
}

/** The status icon alone, for rows that carry their own label. */
export function StatusIcon({ status, className }: { status: string; className?: string }) {
  const cfg = statusConfig[status as keyof typeof statusConfig] ?? statusConfig.pending;
  const Icon = cfg.icon;
  return <Icon className={cn('w-4 h-4 shrink-0', cfg.cls, 'spin' in cfg && cfg.spin && 'animate-spin', className)} />;
}

export function ms(v: number | null) {
  if (v == null) return '—';
  return v < 1000 ? `${v}ms` : `${(v / 1000).toFixed(1)}s`;
}

export function elapsed(s: number | null | undefined) {
  if (s == null) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export function when(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  const aheadMs = d.getTime() - Date.now();
  // A time still to come (a schedule's next slot, a mission's wake). Every
  // future time used to fall into "just now", because its age is negative.
  // Only from a full minute ahead: a timestamp the server wrote a moment ago
  // can be a second ahead of this browser's clock, and a run that just
  // started must not read "in 1m".
  if (aheadMs >= 60_000) {
    const ahead = Math.round(aheadMs / 60_000);
    if (ahead < 60) return `in ${ahead}m`;
    if (ahead < 1440) return `in ${Math.round(ahead / 60)}h`;
    return `in ${Math.round(ahead / 1440)}d`;
  }
  const mins = Math.floor(-aheadMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * `when` for a time that is expected to be ahead (a next slot, a wake).
 * Under a minute ahead reads "in <1m" here, where `when` says "just now"
 * because for a past event that gap is clock skew.
 */
export function until(iso: string | null) {
  if (!iso) return '—';
  const aheadMs = new Date(iso).getTime() - Date.now();
  if (aheadMs > 0 && aheadMs < 60_000) return 'in <1m';
  return when(iso);
}
