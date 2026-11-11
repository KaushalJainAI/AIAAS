/**
 * Placeholders for content whose shape is already known: a list of rows, a
 * row of tiles, a block of text.
 *
 * The shimmer is the app's `animate-shimmer` (a highlight sweeping over a muted
 * base). It moves `background-position`, which repaints but does not change
 * layout, so the rest of the page is undisturbed. Callers size each placeholder
 * to match the row or tile it stands in for, so nothing jumps when data lands.
 * Under reduced motion the global rule in `index.css` ends the sweep at once.
 */
import { cn } from '../../lib/utils';

/** A single shimmering block. Give it the size of what it stands in for. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'rounded-lg bg-muted bg-[linear-gradient(90deg,transparent_0%,hsl(var(--card)/0.6)_50%,transparent_100%)] bg-[size:200%_100%] animate-shimmer',
        className,
      )}
    />
  );
}

/**
 * A list of solution-row placeholders. 88px is the height of a `SolutionRow`
 * with its problem, byline and badges; the `space-y-2` gap is the list's own.
 */
export function SkeletonList({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <ul aria-label={label} aria-busy="true" className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i}>
          <Skeleton className="h-[88px] w-full" />
        </li>
      ))}
    </ul>
  );
}
