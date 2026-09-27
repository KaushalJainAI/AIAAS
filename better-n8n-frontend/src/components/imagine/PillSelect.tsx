/**
 * Compact inline dropdown for a composer setting.
 *
 * Aspect ratio and size are the two controls people change most, so they sit
 * in the prompt bar the way every generator puts them there, rather than
 * behind a drawer. The drawer keeps the long tail (negative prompt, seed,
 * quality, speed).
 */
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

interface Props<T extends string | number> {
  label: string;
  options: T[];
  value: T | undefined;
  onChange: (next: T) => void;
  format?: (option: T) => string;
  icon?: React.ReactNode;
}

export function PillSelect<T extends string | number>({
  label,
  options,
  value,
  onChange,
  format,
  icon,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (options.length === 0) return null;

  const display = value === undefined ? label : (format?.(value) ?? String(value));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={label}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border transition-colors',
          open
            ? 'border-primary/50 bg-primary/10 text-primary'
            : 'border-border/60 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        )}
      >
        {icon}
        {display}
        <ChevronDown size={11} className="opacity-60" />
      </button>

      {open && (
        // Opens upward: the prompt bar sits low in the viewport, so a
        // downward menu would be clipped by the results grid below it.
        <div className="absolute bottom-full left-0 mb-1.5 z-30 min-w-[112px] max-h-[240px] overflow-y-auto rounded-lg border border-border bg-card shadow-lg p-1 custom-scrollbar">
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
            {label}
          </div>
          {options.map(option => (
            <button
              key={String(option)}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left transition-colors',
                option === value
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'hover:bg-muted/60',
              )}
            >
              <span className="flex-1 truncate">{format?.(option) ?? String(option)}</span>
              {option === value && <Check size={12} className="shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
