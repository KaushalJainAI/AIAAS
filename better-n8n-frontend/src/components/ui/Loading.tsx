/**
 * The shared waiting states.
 *
 * Two of them, deliberately. `Skeleton` is for content whose shape is already
 * known — a list of rows, a card grid — because holding the layout still while
 * data lands is what stops the page jumping under the cursor. `AppLoader` is
 * for the moments where nothing about the next screen is known yet (the auth
 * check before the first route renders), where a skeleton would be a lie.
 *
 * Both collapse to a static frame under `prefers-reduced-motion`, via the
 * global rule in `index.css` — no component here needs to check it.
 */

import { cn } from '../../lib/utils';

/** A single pulsing placeholder block. Give it the size of what it stands in for. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />;
}

/** One spinner, three sizes. Colour inherits — primary on primary buttons,
 *  muted everywhere else. No per-call-site size/color improvisation. */
export function Spinner({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const dims =
    size === 'sm' ? 'w-3.5 h-3.5' : size === 'lg' ? 'w-6 h-6' : 'w-4 h-4';
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        'inline-block rounded-full border-2 border-current border-t-transparent animate-spin opacity-60',
        dims,
        className,
      )}
    />
  );
}

/**
 * Full-screen loader for a boot-time wait. The ring and the label fade in
 * after a beat so a fast check (the common case) never flashes a loader.
 */
export function AppLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background">
      <div className="relative h-12 w-12 text-primary">
        <div className="absolute inset-0 rounded-full border-2 border-current opacity-15" />
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-current" />
        <div className="absolute inset-2 rounded-full bg-current opacity-10 animate-pulse" />
      </div>
      <p className="micro-label animate-fade-in">
        {label}
      </p>
    </div>
  );
}
