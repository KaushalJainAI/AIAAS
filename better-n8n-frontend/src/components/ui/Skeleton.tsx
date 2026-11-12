/**
 * Placeholders for content whose shape is already known: a list of rows, a
 * row of tiles, a block of text.
 *
 * A flat muted block that pulses. It changes opacity only, so the rest of the
 * page is undisturbed. Callers size each placeholder to match the row or tile
 * it stands in for, so nothing jumps when data lands. Under reduced motion the
 * global rule in `index.css` stops the pulse.
 */
import { cn } from '../../lib/utils';

/** A single pulsing block. Give it the size of what it stands in for. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('rounded-md bg-muted animate-pulse', className)}
    />
  );
}

/**
 * A list of solution-row placeholders, drawn as the same bordered, divided
 * list the rows land in. Each row is the height of a `SolutionRow` with its
 * problem, byline and badges (~76px), so nothing moves when data arrives.
 */
export function SkeletonList({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <ul
      aria-label={label}
      aria-busy="true"
      className="overflow-hidden rounded-md border border-border bg-card divide-y divide-border/60"
    >
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="h-[76px] space-y-2 px-4 py-3">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-4 w-14" />
        </li>
      ))}
    </ul>
  );
}
