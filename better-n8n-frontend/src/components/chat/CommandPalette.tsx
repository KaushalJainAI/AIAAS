/**
 * The `/` palette above the composer (§18.3).
 *
 * Typing `/` **at the start of the input** opens this above the composer:
 * fuzzy match on name + summary, ↑/↓, Enter/Tab to pick, Esc to close. A `/`
 * anywhere else is plain text. Once a command is picked, each argument
 * completes from `/commands/complete/`; a resolved entity (agent, skill,
 * file, connection) becomes a chip carrying its id.
 *
 * GUI-first on desktop and phone: full-width sheet on small screens
 * (thumb-reachable, 44px rows), anchored popover on desktop. Touch targets
 * never shrink below 44px; the list scrolls inside a capped sheet so the
 * keyboard staying open does not push the palette off screen.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { rankCommands, type CommandDef } from '../../lib/commands';

interface CommandPaletteProps {
  open: boolean;
  commands: CommandDef[];
  query: string;
  onPick: (command: CommandDef) => void;
  onClose: () => void;
  /** Element the desktop popover anchors above (the composer box). */
  anchorClassName?: string;
}

const GROUP_LABELS: Record<string, string> = {
  agents: 'Agents',
  goals: 'Goals',
  memory: 'Memory',
  code: 'Code',
  browse: 'Browser',
  data: 'Data',
  files: 'Files',
  office: 'Documents',
  general: 'General',
};

export default function CommandPalette({
  open,
  commands,
  query,
  onPick,
  onClose,
}: CommandPaletteProps) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const ranked = useMemo(
    () => rankCommands(query, commands),
    [query, commands],
  );

  /* Reset the highlight when the palette opens or the query changes — during
     render, not in an effect: the previous open/query are state, and adjusting
     `active` alongside them is the render-phase pattern the rule wants. */
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevQuery, setPrevQuery] = useState(query);
  if (open !== prevOpen || (open && query !== prevQuery)) {
    setPrevOpen(open);
    setPrevQuery(query);
    setActive(0);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, ranked.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (ranked[active]) {
          e.preventDefault();
          onPick(ranked[active]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, ranked, active, onPick, onClose]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const grouped = new Map<string, CommandDef[]>();
  for (const command of ranked) {
    const group = command.group ?? 'general';
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push(command);
  }
  let running = 0;

  return (
    <>
      {/* Tapping outside closes — the palette is a sheet, not a mode. */}
      <div
        className="fixed inset-0 z-[60]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="listbox"
        aria-label="Slash commands"
        className={cn(
          'absolute z-[61] overflow-hidden rounded-xl border border-border bg-card shadow-xl',
          // Phone: full-width sheet above the composer, thumb-reachable rows.
          // Desktop: anchored popover, same component.
          'inset-x-0 bottom-[calc(100%+8px)] max-h-[min(60vh,380px)]',
          'sm:inset-x-auto sm:left-0 sm:right-0',
        )}
      >
        <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-muted-foreground">
            {query ? `/${query}` : 'Type a command'}
          </span>
          <button
            onClick={onClose}
            aria-label="Close commands"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div
          ref={listRef}
          className="max-h-[min(52vh,320px)] overflow-y-auto p-1.5"
        >
          {ranked.length === 0 && (
            <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
              No command matches. Try /help.
            </div>
          )}
          {[...grouped.entries()].map(([group, items]) => (
            <div key={group}>
              <div className="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">
                {GROUP_LABELS[group] ?? group}
              </div>
              {items.map((command) => {
                const index = running++;
                return (
                  <button
                    key={command.name}
                    data-index={index}
                    role="option"
                    aria-selected={index === active}
                    onClick={() => onPick(command)}
                    onMouseEnter={() => setActive(index)}
                    className={cn(
                      // 44px rows: thumb-reachable on phones, roomy on desktop.
                      'flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left',
                      index === active
                        ? 'bg-primary/10 text-foreground'
                        : 'text-foreground/80 hover:bg-muted/50',
                    )}
                  >
                    <span className="shrink-0 font-mono text-[13px] font-bold text-primary">
                      /{command.name}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                      {command.summary}
                    </span>
                    <CornerDownLeft className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      index === active ? 'text-primary' : 'text-muted-foreground/30',
                    )} />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
