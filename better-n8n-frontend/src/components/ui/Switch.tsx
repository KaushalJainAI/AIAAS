import { cn } from '../../lib/utils';

/**
 * The Connections/Schedules/AgentBuilder toggle in one place.
 *
 * A small squared toggle: a 4px-radius track with a 3px-radius knob and no
 * shadow. On = `bg-primary` (teal), off = a muted track.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded transition-colors duration-normal ease-standard',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        'focus-visible:ring-offset-2 focus-visible:ring-offset-card',
        'disabled:opacity-50 disabled:pointer-events-none',
        checked ? 'bg-primary' : 'bg-muted-foreground/30',
      )}
    >
      {/* The knob is absolutely placed and travels 16px (track 36px − 2×2px inset − 16px knob),
          so it glides rather than jumping sides. Only transform moves. */}
      <span
        aria-hidden
        className={cn(
          'absolute left-0.5 top-0.5 h-4 w-4 rounded-[3px] bg-white transition-transform duration-normal ease-decelerate',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  );
}
