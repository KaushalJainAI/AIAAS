/**
 * The composer send button.
 *
 * One button, five copies: the standalone chat used a round `ArrowUp`, the
 * docked chat panel a round `ArrowRight`, Imagine a squared paper-plane, the
 * agent builder a sharp-cornered paper-plane, and the clarification modal a
 * pill hardcoded to `bg-blue-600` — which ignored the theme entirely and stayed
 * the same blue in both light and dark. This is that button, once.
 *
 * The states are the union of what those call sites actually needed:
 *
 * | state              | look                        | clickable |
 * |--------------------|-----------------------------|-----------|
 * | idle               | primary circle, `ArrowUp`   | yes       |
 * | busy + `onStop`    | red circle, stop square     | yes       |
 * | busy, no `onStop`  | primary circle, spinner     | no        |
 * | locked             | primary circle, padlock     | no        |
 *
 * A stoppable stream stays clickable on purpose: that button is the only way
 * to interrupt generation, so disabling it while busy would remove the one
 * control the user needs at exactly the moment they need it.
 */
import { ArrowUp, Loader2, Lock, Square } from 'lucide-react';
import { cn } from '../../lib/utils';

type SendButtonSize = 'sm' | 'md';

interface SendButtonProps {
  onClick: () => void;
  /** Renders the stop affordance while `busy`; omit for a plain spinner. */
  onStop?: () => void;
  /** Request in flight. */
  busy?: boolean;
  /** Blocked on setup (e.g. no credential) rather than on input. */
  locked?: boolean;
  disabled?: boolean;
  size?: SendButtonSize;
  /** Overrides the tooltip; the state-appropriate default is usually right. */
  title?: string;
  type?: 'button' | 'submit';
  className?: string;
}

const SIZES: Record<SendButtonSize, { button: string; icon: string; stop: string }> = {
  sm: { button: 'w-8 h-8', icon: 'w-3.5 h-3.5', stop: 'w-2.5 h-2.5' },
  md: { button: 'w-9 h-9', icon: 'w-4 h-4', stop: 'w-3 h-3' },
};

export function SendButton({
  onClick,
  onStop,
  busy = false,
  locked = false,
  disabled = false,
  size = 'md',
  title,
  type = 'button',
  className,
}: SendButtonProps) {
  const canStop = busy && !!onStop;
  const isInert = locked || (busy && !canStop) || (!busy && disabled);
  const dimensions = SIZES[size];

  const defaultTitle = canStop
    ? 'Stop generating'
    : locked
      ? 'Unavailable'
      : busy
        ? 'Sending…'
        : 'Send message';

  return (
    <button
      type={type}
      onClick={canStop ? onStop : onClick}
      disabled={isInert}
      title={title ?? defaultTitle}
      aria-label={title ?? defaultTitle}
  className={cn(
    'shrink-0 rounded-full flex items-center justify-center shadow-sm transition-colors duration-150',
    // Never let a disabled button look pressable.
    'disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed',
    canStop
      ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
      : 'bg-primary text-primary-foreground hover:bg-primary/90',
        dimensions.button,
        className,
      )}
    >
      {canStop ? (
        <Square className={cn(dimensions.stop, 'fill-current')} />
      ) : busy ? (
        <Loader2 className={cn(dimensions.icon, 'animate-spin')} />
      ) : locked ? (
        <Lock className={dimensions.icon} />
      ) : (
        <ArrowUp className={dimensions.icon} />
      )}
    </button>
  );
}
