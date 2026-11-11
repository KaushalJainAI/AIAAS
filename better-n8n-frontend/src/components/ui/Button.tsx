import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';
import { Spinner } from './Loading';

type Variant = 'primary' | 'secondary' | 'destructive' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary:
    'border border-border bg-card hover:bg-secondary text-foreground',
  destructive:
    'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  ghost:
    'text-muted-foreground hover:bg-secondary hover:text-foreground',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-6 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

/**
 * One button for the whole app.
 *
 * Replaces ~65 hand-rolled `bg-primary ... rounded px-4 py-2` copies with
 * 6 radii, 4 paddings and 3 disabled opacities. Radius is always `rounded-md` (6px),
 * weight always `font-semibold`, motion always `transition-colors`.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      disabled,
      className,
      children,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-semibold',
        // Press feedback is a transform, so it gets the fast (100ms) token with the colours.
        'transition-[color,background-color,transform] duration-fast ease-standard',
        'enabled:active:scale-[0.98]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:opacity-50 disabled:pointer-events-none',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
