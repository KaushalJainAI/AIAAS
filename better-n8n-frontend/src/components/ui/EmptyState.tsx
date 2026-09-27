import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Centered (grids, queues) or left-aligned (list pages) empty state.
 *
 * Promoted from `Evals.tsx::Empty` — the only page that had one. Replaces
 * ~10 hand-rolled `flex flex-col items-center py-14/16/20` blocks with 5
 * different icon tiles. Empty is never `destructive/5`: empty ≠ error.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  align = 'center',
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
  align?: 'center' | 'left';
}) {
  const centered = align === 'center';
  return (
    <div
      className={cn(
        centered
          ? 'flex flex-col items-center justify-center py-16 text-center'
          : 'max-w-md py-12',
      )}
    >
      <div
        className={cn(
          'rounded-lg bg-muted border border-border flex items-center justify-center mb-3',
          centered ? 'p-3' : 'w-10 h-10',
        )}
      >
        <Icon
          className={centered ? 'w-6 h-6 text-muted-foreground' : 'w-5 h-5 text-muted-foreground'}
        />
      </div>
      <h3
        className={cn(
          centered ? 'text-sm font-medium' : 'font-semibold mb-1',
        )}
      >
        {title}
      </h3>
      {body && (
        <p
          className={cn(
            centered
              ? 'text-xs text-muted-foreground mt-1 max-w-md'
              : 'text-[13px] text-muted-foreground leading-relaxed mb-4',
          )}
        >
          {body}
        </p>
      )}
      {action && <div className={centered ? 'mt-4' : 'flex items-center gap-2'}>{action}</div>}
    </div>
  );
}
