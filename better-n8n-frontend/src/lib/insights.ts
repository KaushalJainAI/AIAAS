/**
 * One color language for Insights, so a hue means the same thing in every
 * card. The old page reused one blue/primary bar for success and failure
 * alike — a day with every run failing looked identical to a perfect one —
 * and printed every success rate in the same gray whether it was 99% or 41%.
 *
 * - emerald: succeeded / healthy
 * - red: failed
 * - amber: waiting on a person (approvals, paused)
 * - blue: volume — how much happened, with no verdict attached
 * - muted: everything else (callers, unclassified statuses)
 */

export type RateBand = 'good' | 'warn' | 'bad';

/** 95+ is healthy, 80+ is watchable, below is failing. Bands, not a gradient:
 *  a gradient makes 81% and 79% look like neighbours; they are different states. */
export function rateBand(rate: number | null | undefined): RateBand {
  if (rate == null || Number.isNaN(rate)) return 'warn';
  if (rate >= 95) return 'good';
  if (rate >= 80) return 'warn';
  return 'bad';
}

const RATE_TEXT: Record<RateBand, string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-red-500',
};

/** Text color for a success-rate number. The number carries the verdict now. */
export function rateTextClass(rate: number | null | undefined): string {
  return RATE_TEXT[rateBand(rate)];
}

/** Runs on a day that did not succeed: completed is the only success state,
 *  so paused/cancelled/running days count as not-ok here, same as the failed
 *  ones — the bar shows "green vs the rest", never "green vs red only". */
export function dayFailed(day: { count: number; success: number }): number {
  return Math.max(0, (day.count || 0) - (day.success || 0));
}

/** Day success percentage, or null when nothing ran (a gap, not a zero). */
export function dayRate(day: { count: number; success: number }): number | null {
  if (!day.count) return null;
  return (day.success / day.count) * 100;
}

/** `cost_usd` arrives as a decimal string; unpriced rows send '0.000000'. */
export function parseCost(costUsd: string | number | null | undefined): number {
  const n = typeof costUsd === 'number' ? costUsd : parseFloat(costUsd ?? '');
  return Number.isFinite(n) ? n : 0;
}

const STATUS_BAR: Record<string, string> = {
  completed: 'bg-emerald-500/70',
  failed: 'bg-red-500/70',
  paused: 'bg-amber-500/70',
  running: 'bg-blue-500/70',
  cancelled: 'bg-muted-foreground/40',
};

/** Bar fill for a run status. Unknown statuses render muted, never green:
 *  an unfamiliar state must not borrow the healthy color. */
export function statusBarClass(status: string): string {
  return STATUS_BAR[status] ?? 'bg-muted-foreground/40';
}

/** Donut stroke for a run status — same mapping as the bars. */
export function statusStroke(status: string): string {
  switch (status) {
    case 'completed': return '#10b981';
    case 'failed': return '#ef4444';
    case 'paused': return '#f59e0b';
    case 'running': return '#3b82f6';
    default: return '#9ca3af';
  }
}
