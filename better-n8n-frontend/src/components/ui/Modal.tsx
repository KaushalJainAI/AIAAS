import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { usePresence } from '../../hooks/usePresence';

interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  label?: string;
  /**
   * Optional. Omitted, the modal is open for as long as it is rendered, which is
   * how every existing caller uses it (`{x && <Modal …/>}`). Pass `open` to get
   * the exit animation: the modal stays up for ~100ms after it turns false.
   */
  open?: boolean;
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-6xl',
} as const;

/** The exit is the accelerate fade/scale, ~30% shorter than the 220ms enter. */
const EXIT_MS = 100;

/**
 * One overlay + box for the whole app.
 *
 * Replaces 16 copies with 4 scrims (`bg-black/50`, `bg-background/80+blur`,
 * `bg-slate-900/60+blur`, solid) and 4 z-values. Scrim is always
 * `bg-black/50`, always `z-50` (toasts own `z-[200]`). Backdrop fades in and
 * out; the panel scales in and out. Escape closes; body scroll locks.
 *
 * The box is a capped flex column (`max-h`, `dvh` so a phone URL bar cannot
 * push the footer off screen) and `ModalBody` is the scroll region — header
 * and footer stay pinned while long forms scroll between them. Without this
 * a tall dialog grows past the viewport and its actions are unreachable
 * (body scroll is locked while open).
 */
export function Modal({ onClose, children, size = 'md', label, open = true }: ModalProps) {
  const { present, state } = usePresence(open, EXIT_MS);
  const exiting = state === 'exit';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (!present) return null;

  return (
    <div
      className={cn(
        'overlay z-50 flex items-center justify-center p-4',
        exiting ? 'animate-fade-out' : 'entrance-overlay',
      )}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        // A closing dialog must not take clicks or focus while it fades.
        inert={exiting}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'modal w-full flex flex-col max-h-[90vh] max-h-[90dvh]',
          SIZES[size],
          exiting ? 'animate-scale-out' : 'entrance-modal',
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('px-5 py-4 flex-1 min-h-0 overflow-y-auto', className)}>
      {children}
    </div>
  );
}

export function ModalFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2 px-5 py-4 border-t border-border shrink-0',
        className,
      )}
    >
      {children}
    </div>
  );
}
