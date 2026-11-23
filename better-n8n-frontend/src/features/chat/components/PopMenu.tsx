/**
 * A small menu that hangs off its own button on desktop, and rises as a bottom
 * sheet on phones. The caller draws the trigger and the items; this only picks
 * the shape and handles closing.
 *
 * Desktop: a click outside the menu, or Escape, closes it. Phones: the sheet is
 * a `Modal`, which already closes on Escape and on a tap outside.
 *
 * Nothing here is hover-only: the trigger is a normal button that opens it.
 */
import { useEffect, useRef, type ReactNode } from 'react';

import { Modal } from '@/components/ui/Modal';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { cn } from '@/lib/utils';

interface PopMenuProps {
  /** Names the menu for assistive tech, and titles the phone sheet. */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The button that opens the menu. It sits inside the anchor, so a click on it is not "outside". */
  trigger: ReactNode;
  /** Which edge of the trigger the desktop menu lines up with. */
  align?: 'left' | 'right';
  children: ReactNode;
}

export default function PopMenu({
  label,
  open,
  onOpenChange,
  trigger,
  align = 'right',
  children,
}: PopMenuProps) {
  const desktop = useIsDesktop();
  const anchorRef = useRef<HTMLDivElement>(null);

  // Desktop only: a press outside the anchor, or Escape, closes the popover.
  useEffect(() => {
    if (!open || !desktop) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!anchorRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, desktop, onOpenChange]);

  return (
    <div ref={anchorRef} className="relative inline-flex shrink-0">
      {trigger}
      {open && desktop && (
        <div
          aria-label={label}
          className={cn(
            'absolute top-full z-50 mt-1 w-[17rem] rounded-md border border-border bg-card p-1.5 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {children}
        </div>
      )}
      {open && !desktop && (
        <Modal size="sm" label={label} onClose={() => onOpenChange(false)}>
          <div className="p-2">{children}</div>
        </Modal>
      )}
    </div>
  );
}

/**
 * One row in a `PopMenu`: a full-width button, 44px tall on phones. Used by the
 * menus in this folder so every row has the same size and hover state.
 */
export function PopMenuItem({
  onClick,
  disabled = false,
  destructive = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 text-left text-[13px] transition-colors md:min-h-8 md:text-[12px]',
        'disabled:opacity-40',
        destructive
          ? 'text-destructive hover:bg-destructive-subtle'
          : 'text-foreground hover:bg-secondary',
      )}
    >
      {children}
    </button>
  );
}
