import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

/**
 * Icon-only action (card menus, row actions, modal close).
 *
 * Was ~20 copies of `p-1.5 hover:bg-muted rounded-lg` with aria-label and
 * focus ring present about half the time. This one always has both, and
 * never hides on hover-only (pair with `focus-visible:opacity-100` at the
 * call site when the button lives in a hover-reveal).
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'p-1.5 rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground',
        'transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:opacity-50 disabled:pointer-events-none',
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = 'IconButton';
