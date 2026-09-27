/**
 * Searchable multi-select.
 *
 * Built for the case where the list is long. Chips-in-a-row works for six
 * connectors and collapses at two hundred, which is where a real account with
 * every Google surface, every MCP server and every knowledge base ends up.
 *
 * So: search first, selected items pinned to the top, and a hard cap on rendered
 * rows. The cap is what keeps a 2,000-item list from freezing the panel — you
 * narrow by typing rather than by scrolling.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface Option {
  id: string;
  label: string;
  hint?: string;
}

const MAX_ROWS = 50;

export default function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'Nothing to choose from yet.',
}: {
  options: Option[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    inputRef.current?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = useMemo(
    () => value.map((id) => options.find((o) => o.id === id)).filter(Boolean) as Option[],
    [value, options]
  );

  const { rows, total } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? options.filter(
          (o) => o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q)
        )
      : options;
    // Selected first, so what you already picked never scrolls out of reach.
    const ranked = [...matches].sort(
      (a, b) => Number(value.includes(b.id)) - Number(value.includes(a.id))
    );
    return { rows: ranked.slice(0, MAX_ROWS), total: matches.length };
  }, [options, query, value]);

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full min-h-9 px-2 py-1.5 rounded border border-input bg-background text-left flex items-center gap-1.5 flex-wrap"
      >
        {selected.length === 0 ? (
          <span className="text-sm text-muted-foreground px-1">{placeholder}</span>
        ) : (
          selected.map((o) => (
            <span
              key={o.id}
              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded bg-primary-subtle border border-primary-line text-primary text-[12px] font-medium"
            >
              {o.label}
              <span
                role="button"
                tabIndex={-1}
                aria-label={`Remove ${o.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(o.id);
                }}
                className="p-0.5 rounded hover:bg-primary/15"
              >
                <X className="w-3 h-3" />
              </span>
            </span>
          ))
        )}
        <ChevronDown
          className={cn(
            'w-4 h-4 text-muted-foreground ml-auto shrink-0 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-card border border-border rounded shadow-lg">
          <div className="flex items-center gap-2 px-2.5 py-2 border-b border-border">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {value.length > 0 && (
              <button
                onClick={() => onChange([])}
                className="text-[12px] text-muted-foreground hover:text-foreground shrink-0"
              >
                Clear
              </button>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {options.length === 0 ? (
              <p className="px-3 py-3 text-[13px] text-muted-foreground">{emptyText}</p>
            ) : rows.length === 0 ? (
              <p className="px-3 py-3 text-[13px] text-muted-foreground">
                Nothing matches “{query}”.
              </p>
            ) : (
              rows.map((o) => {
                const on = value.includes(o.id);
                return (
                  <button
                    key={o.id}
                    onClick={() => toggle(o.id)}
                    className="w-full flex items-start gap-2.5 px-3 py-1.5 text-left hover:bg-secondary"
                  >
                    <span
                      className={cn(
                        'mt-0.5 w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0',
                        on ? 'bg-primary border-primary' : 'border-border-strong'
                      )}
                    >
                      {on && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] text-foreground">{o.label}</span>
                      {o.hint && (
                        <span className="block text-[12px] text-muted-foreground truncate">{o.hint}</span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {total > rows.length && (
            <p className="px-3 py-1.5 border-t border-border text-[12px] text-muted-foreground">
              Showing {rows.length} of {total} — keep typing to narrow it down.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
