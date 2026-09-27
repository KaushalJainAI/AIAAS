import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type Tone = 'primary' | 'neutral' | 'agent' | 'success' | 'warning';

const TONES: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary border-border',
  neutral: 'bg-muted text-muted-foreground border-border',
  agent: 'bg-agent-subtle text-agent border-agent-line',
  success: 'bg-success-subtle text-success border-border',
  warning: 'bg-warning-subtle text-warning border-border',
};

/**
 * The `w-10 h-10 / w-11 h-11 / w-12 h-12 + p-2.5/p-3 + bg-*` cluster that
 * appears ~35 times (auth logos, card icons, empty tiles, stat tiles).
 * `PageHeader` is the canonical consumer.
 */
export function IconTile({
  tone = 'primary',
  size = 'md',
  className,
  children,
}: {
  tone?: Tone;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  children: ReactNode;
}) {
  const dims =
    size === 'sm'
      ? 'w-8 h-8'
      : size === 'lg'
        ? 'w-12 h-12'
        : 'w-10 h-10';
  return (
    <div
      className={cn(
        'rounded-lg border flex items-center justify-center shrink-0',
        dims,
        TONES[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}
