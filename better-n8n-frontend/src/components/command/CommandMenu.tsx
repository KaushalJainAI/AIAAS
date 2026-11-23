import { Fragment, useEffect, useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, ModalBody } from '../ui/Modal';
import {
  buildCommands,
  normaliseQuery,
  nextIndex,
  rankCommands,
  readCachedSources,
} from '../../lib/commandMenu';
import type { CommandItem } from '../../lib/commandMenu';
import { cn } from '../../lib/utils';

/* Cmd+K. One search over what the app can open: the actions, the five
 * destinations with their tabs, the Settings sections, and the chats and
 * agents already in the cache. Opened by App.tsx (the shortcut) or by the
 * Search buttons in the sidebar and the phone top bar.
 *
 * Phones: Modal is a bottom sheet already; this gives it a fixed height so the
 * input stays at the top while the results change. Rows are 44px on phones.
 * The combobox follows the ARIA pattern: focus stays in the input and
 * aria-activedescendant names the highlighted row.
 */

const optionId = (listId: string, index: number) => `${listId}-option-${index}`;

export default function CommandMenu({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Read once, on open: whatever the cache holds now. Nothing is fetched here.
  const [commands] = useState(() => buildCommands(readCachedSources(queryClient)));
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(() => rankCommands(query, commands), [query, commands]);
  const listId = useId();
  // Headings group the rows only while nothing is typed. A search is one ranked list.
  const showHeadings = normaliseQuery(query) === '';
  const activeIndex = results.length === 0 ? -1 : Math.min(active, results.length - 1);

  // Keep the highlighted row on screen as the arrow keys move through a long list.
  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(optionId(listId, activeIndex))?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, listId]);

  const run = (item: CommandItem) => {
    onClose();
    navigate(item.to, item.state ? { state: item.state } : undefined);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter confirms an IME composition; it must not open a row.
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(nextIndex(activeIndex, e.key === 'ArrowDown' ? 1 : -1, results.length));
    } else if (e.key === 'Enter') {
      const item = results[activeIndex];
      if (!item) return;
      e.preventDefault();
      run(item);
    }
  };

  const trimmed = query.trim();

  return (
    <Modal onClose={onClose} size="md" label="Search">
      {/* Phones: the sheet is 92dvh, less the 12px drag handle Modal draws above
          this box and the home-indicator inset Modal pads below it. Desktop: a
          fixed-height panel that does not jump as results change. */}
      <div className="flex min-h-0 flex-col max-md:h-[calc(92dvh-0.75rem-env(safe-area-inset-bottom))] md:h-[min(560px,70dvh)]">
        <div className="shrink-0 border-b border-border p-3">
          <input
            type="text"
            role="combobox"
            aria-label="Search chats, agents and pages"
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-activedescendant={activeIndex >= 0 ? optionId(listId, activeIndex) : undefined}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            placeholder="Search chats, agents and pages"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-11 w-full rounded-md border border-border bg-background px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
          />
        </div>

        <ModalBody className="px-2 py-2">
          <div id={listId} role="listbox" aria-label="Results">
            {results.map((item, i) => (
              <Fragment key={item.id}>
                {showHeadings && (i === 0 || results[i - 1].section !== item.section) && (
                  <div role="presentation" className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                    {item.section}
                  </div>
                )}
                <div
                  id={optionId(listId, i)}
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(item)}
                  className={cn(
                    'flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 text-sm text-foreground md:min-h-9',
                    i === activeIndex ? 'bg-muted' : 'hover:bg-muted/60',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {/* Context on the right: the hub or Settings a row belongs to,
                      or, while searching, the section it came from. */}
                  <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
                    {showHeadings ? item.hint : (item.hint ?? item.section)}
                  </span>
                </div>
              </Fragment>
            ))}
          </div>
          {results.length === 0 && trimmed !== '' && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing matches “{trimmed}”.
            </p>
          )}
          <p role="status" className="sr-only">
            {results.length === 0 ? 'No results' : `${results.length} result${results.length === 1 ? '' : 's'}`}
          </p>
        </ModalBody>

        {/* Keys only exist on a keyboard, so the hint is for desktop. */}
        <p className="hidden shrink-0 border-t border-border px-4 py-2 text-xs text-muted-foreground md:block">
          ↑ ↓ to move · Enter to open · Esc to close
        </p>
      </div>
    </Modal>
  );
}
