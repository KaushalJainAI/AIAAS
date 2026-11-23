/**
 * The row of tabs at the top of the side pane. It draws what it is given and
 * reports clicks through its callbacks. It also does three things of its own,
 * all of them about the strip and nothing global:
 *
 * - keeps the active tab in view when the tabs overflow sideways;
 * - keyboard: Left and Right arrows move between tabs, Delete closes the
 *   focused tab (roving focus, so the strip is one Tab stop);
 * - on a phone, a downward swipe of more than 80px on the strip hides the
 *   pane (the same as Back). The body does not take the swipe: PDFs, sheets
 *   and maps need their own drags.
 *
 * Phones get 44px touch targets and the top safe-area inset. The Back button
 * is only drawn below `md`, where the pane is a full-screen page.
 */
import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { ArrowLeft, FileText, Globe, FileCode, Image, Link2, MoreHorizontal, Video, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  isSwipeDownToClose,
  neighbourTabId,
  tabAfterClose,
  type PaneTab,
} from '@/lib/paneTabs';
import { isPhone } from './paneState';

interface Props {
  tabs: PaneTab[];
  activeId: string | null;
  menuOpen?: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** null: the ⋯ button, which acts on the active tab. An id: a right-click on that tab. */
  onMenu: (id: string | null) => void;
  /** Phone only: hide the pane, keep the tabs. */
  onBack: () => void;
}

function IconFor({ tab }: { tab: PaneTab }) {
  const cls = 'h-3.5 w-3.5 shrink-0 text-muted-foreground';
  switch (tab.kind) {
    case 'browser':
      return <Globe className={cls} aria-hidden />;
    case 'html':
      return <FileCode className={cls} aria-hidden />;
    case 'media':
      return tab.mediaType === 'video' ? <Video className={cls} aria-hidden /> : <Image className={cls} aria-hidden />;
    case 'link':
      return <Link2 className={cls} aria-hidden />;
    case 'file':
      return <FileText className={cls} aria-hidden />;
  }
}

/** The tab button for an id inside the strip, found without a CSS selector. */
function tabElement(list: HTMLElement | null, id: string): HTMLElement | null {
  if (!list) return null;
  const found = Array.from(list.querySelectorAll<HTMLElement>('[data-tab-id]'));
  return found.find((el) => el.dataset.tabId === id) ?? null;
}

export default function PaneTabStrip({ tabs, activeId, menuOpen = false, onActivate, onClose, onMenu, onBack }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  // Set by a key press that moves focus; applied once the tab is on screen.
  const pendingFocus = useRef<string | null>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  // Keep the active tab in view when the tabs overflow. jsdom has no
  // scrollIntoView, so the call is guarded.
  useEffect(() => {
    const el = tabElement(listRef.current, activeId ?? '');
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [activeId]);

  // Runs after every render, so a focus request made before the tab exists
  // lands once it does.
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    const el = tabElement(listRef.current, id);
    if (el) {
      pendingFocus.current = null;
      el.focus();
    }
  });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = (e.target as Element).closest<HTMLElement>('[data-tab-id]');
    const id = target?.dataset.tabId;
    if (!id) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const next = neighbourTabId(tabs, id, e.key === 'ArrowRight' ? 1 : -1);
      if (!next) return;
      e.preventDefault();
      pendingFocus.current = next;
      onActivate(next);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      pendingFocus.current = tabAfterClose(tabs, id);
      onClose(id);
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    swipeStart.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || !isPhone()) return;
    if (isSwipeDownToClose(e.clientX - start.x, e.clientY - start.y)) onBack();
  };

  return (
    <div
      className="flex shrink-0 touch-pan-x flex-col border-b border-border/60 pt-[env(safe-area-inset-top)] md:pt-0"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        swipeStart.current = null;
      }}
    >
      <div className="flex h-11 items-stretch gap-0.5 px-1 md:h-9">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          title="Back"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div
          ref={listRef}
          role="tablist"
          aria-label="Open files"
          onKeyDown={onKeyDown}
          className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((tab) => {
            const active = tab.id === activeId;
            return (
              <div
                key={tab.id}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onMenu(tab.id);
                }}
                className={cn(
                  'flex h-11 max-w-[220px] shrink-0 items-stretch rounded-md md:h-9',
                  active ? 'bg-muted' : 'hover:bg-muted/60',
                )}
              >
                <button
                  type="button"
                  role="tab"
                  data-tab-id={tab.id}
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => onActivate(tab.id)}
                  title={tab.title}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-1.5 px-2.5 text-left text-[13px]',
                    active ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <IconFor tab={tab} />
                  <span className="truncate">{tab.title}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onClose(tab.id)}
                  aria-label={`Close ${tab.title}`}
                  title="Close tab"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground md:h-9 md:w-7"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => onMenu(null)}
          data-pane-menu-toggle=""
          aria-label="Tab actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Tab actions"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:h-9 md:w-8"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
