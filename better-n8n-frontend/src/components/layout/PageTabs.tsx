import { useRef, type KeyboardEvent } from 'react';
import { cn } from '../../lib/utils';

export type PageTab<T extends string> = { id: T; label: string; count?: number };

interface PageTabsProps<T extends string> {
  tabs: PageTab<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Names the strip for screen readers, e.g. "Activity sections". */
  label: string;
  /** Prefix for the tab and panel ids; the panel must use `${idPrefix}-panel`. */
  idPrefix: string;
  /** Drawn inside PageHeader's row (its `tabs` slot): no strip of its own,
   * full height of that row so the underline sits on its border. */
  inline?: boolean;
}

/* A page's own tabs, under its PageHeader. Props only: the page owns which tab
 * is open (usually `?tab=` in the URL). 44 px tall on every screen, 24 px in
 * from the edge on desktop so the labels line up with the title above, and the
 * strip scrolls sideways on a narrow phone instead of wrapping. Left/Right,
 * Home and End move between tabs (the WAI-ARIA tabs pattern). */
export default function PageTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix,
  inline = false,
}: PageTabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    const next =
      event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };

  const list = (
      <div
        className={cn('scrollbar-none -mb-px flex gap-6 overflow-x-auto', inline && 'min-w-0 self-stretch')}
        role="tablist"
        aria-label={label}
      >
        {tabs.map(({ id, label: text, count }, index) => {
          const active = id === value;
          return (
            <button
              key={id}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${id}`}
              aria-selected={active}
              aria-controls={`${idPrefix}-panel`}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                'relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm transition-colors duration-normal ease-standard md:text-[14px]',
                inline ? 'h-full' : 'h-11',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40',
                active ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {text}
              {count != null && count > 0 && (
                <span className="rounded bg-secondary px-1.5 font-mono text-[11px] tabular-nums text-foreground">
                  {count}
                </span>
              )}
              {/* The underline grows in and out on transform alone (no layout). */}
              <span
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-primary transition-transform duration-normal ease-decelerate',
                  active ? 'scale-x-100' : 'scale-x-0',
                )}
              />
            </button>
          );
        })}
      </div>
  );
  if (inline) return list;
  return <div className="shrink-0 border-b border-border bg-card px-4 md:px-6">{list}</div>;
}
