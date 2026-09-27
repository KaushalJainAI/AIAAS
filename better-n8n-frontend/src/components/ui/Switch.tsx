import { cn } from '../../lib/utils';

/**
 * The Connections/Schedules/AgentBuilder toggle in one place.
 *
 * Was 3 markups (button `h-5 w-9`, peer-checkbox span, `w-8 h-[18px]`)
 * for one look. `h-5 w-9`, knob `h-4 w-4`, on = `bg-primary`.
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
        'inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        'focus-visible:ring-offset-2 focus-visible:ring-offset-card',
        'disabled:opacity-50 disabled:pointer-events-none',
        checked ? 'bg-primary justify-end' : 'bg-muted-foreground/30 justify-start',
      )}
    >
      <span className="h-4 w-4 shrink-0 rounded-full bg-white shadow-sm" />
    </button>
  );
}
