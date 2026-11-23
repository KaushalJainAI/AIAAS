/**
 * A side pane that previews files without leaving the page, with tabs.
 *
 * Clicking a file an agent wrote used to navigate away from the conversation
 * that explains it. The pane keeps both on screen: the answer on the left, the
 * file on the right, and "Open in <app>" for when the user does want to work
 * on the file.
 *
 * Two shapes. `docked` (the chat) puts the pane beside the page: the
 * conversation narrows rather than being covered, and the pane can be dragged
 * wider or narrower. Otherwise (and always on a phone, where there is no room
 * beside anything) it is a drawer over the page.
 *
 * Several files can be open at once, as tabs. Opening a file that is already
 * open focuses its tab. The tabs of a conversation are kept in sessionStorage
 * when `storageKey` is given, and come back hidden, so a reload never covers
 * the chat.
 *
 * This component also provides `FilePreviewContext`, so `useFilePreview()`
 * (used by `MarkdownMessage` and `FileCards`) keeps working unchanged.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { FilePreviewContext, type FileTarget } from '@/components/files/filePreviewState';
import { cn } from '@/lib/utils';
import { fileTabTitle, paneReducer, type PaneAction, type PaneTabSpec } from '@/lib/paneTabs';
import PaneBody from './PaneBody';
import PaneTabMenu from './PaneTabMenu';
import PaneTabStrip from './PaneTabStrip';
import { PaneContext, isPhone, readPersisted, writePersisted, type PaneContextValue } from './paneState';

const WIDTH_KEY = 'file-preview-pane-width';
const MIN_WIDTH = 360;
const DEFAULT_WIDTH = 560;
/**
 * The chat keeps at least this much of the window. The plan panel collapses
 * to its pill when the chat would be narrower than this (PlanPanel).
 */
export const MIN_PAGE_WIDTH = 420;

function maxWidth(): number {
  return Math.max(MIN_WIDTH, window.innerWidth - MIN_PAGE_WIDTH);
}

function readWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(saved) && saved >= MIN_WIDTH) return saved;
  } catch {
    // Storage blocked: the default width is fine.
  }
  return DEFAULT_WIDTH;
}

/**
 * The pane's state, kept per storage key (one conversation). Another key
 * gets its own tabs. The switch happens during render, as React documents
 * for state that follows a prop, so the old tabs are never saved under the
 * new key.
 */
function usePaneStore(storageKey: string | undefined) {
  const [store, setStore] = useState(() => ({ key: storageKey, state: readPersisted(storageKey) }));
  let current = store;
  if (store.key !== storageKey) {
    current = { key: storageKey, state: readPersisted(storageKey) };
    setStore(current);
  }

  const dispatch = useCallback((action: PaneAction) => {
    setStore((s) => {
      const next = paneReducer(s.state, action);
      return next === s.state ? s : { key: s.key, state: next };
    });
  }, []);

  useEffect(() => {
    if (current.key) writePersisted(current.key, current.state);
  }, [current.key, current.state]);

  return { state: current.state, dispatch };
}

/**
 * On a phone the open pane is a page, so Back closes it instead of leaving
 * the chat. Opening pushes one history entry. Closing the pane by any other
 * route (Back button, header ×, Escape) pops it. The router is not involved,
 * so the URL does not change.
 */
function usePhoneBack(open: boolean, hide: () => void) {
  const pushed = useRef(false);

  useEffect(() => {
    const onPop = () => {
      if (!pushed.current) return;
      pushed.current = false;
      hide();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [hide]);

  useEffect(() => {
    if (open) {
      if (!pushed.current && isPhone()) {
        // Keep whatever the router stored on this entry; only add our flag.
        window.history.pushState({ ...(window.history.state ?? {}), pane: true }, '');
        pushed.current = true;
      }
    } else if (pushed.current) {
      pushed.current = false;
      if (window.history.state?.pane) window.history.back();
    }
  }, [open]);

  useEffect(
    () => () => {
      // Unmounted while open: leave no entry behind.
      if (!pushed.current) return;
      pushed.current = false;
      if (window.history.state?.pane) window.history.back();
    },
    [],
  );
}

export default function SidePane({
  children,
  docked = false,
  storageKey,
  onOpenChange,
  onSendText,
}: {
  children: ReactNode;
  /** Sit beside the page instead of over it (from the md breakpoint up). */
  docked?: boolean;
  /** Where the tabs are kept, e.g. `pane:<conversationId>`. Absent: not kept. */
  storageKey?: string;
  /** Told each time the pane shows or hides (the chat uses it to lay out the plan rail). */
  onOpenChange?: (open: boolean) => void;
  /** Sends a chat message from a tab (the browser hand-off's "I'm done"). Absent outside the chat. */
  onSendText?: (text: string) => void;
}) {
  const { state, dispatch } = usePaneStore(storageKey);

  const reportedOpen = useRef(state.open);
  useEffect(() => {
    if (reportedOpen.current === state.open) return;
    reportedOpen.current = state.open;
    onOpenChange?.(state.open);
  }, [state.open, onOpenChange]);
  // The tab menu's target: a tab id, or null when no menu is open.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const dismissMenu = useCallback(() => setMenuFor(null), []);

  // Every action from the pane's own chrome closes the menu first.
  const act = useCallback(
    (action: PaneAction) => {
      setMenuFor(null);
      dispatch(action);
    },
    [dispatch],
  );

  const hide = useCallback(() => act({ type: 'hide' }), [act]);
  const activate = useCallback((id: string) => act({ type: 'activate', id }), [act]);
  const closeTab = useCallback((id: string) => act({ type: 'close', id }), [act]);
  const retitle = useCallback((id: string, title: string) => dispatch({ type: 'retitle', id, title }), [dispatch]);
  const openFile = useCallback(
    (target: FileTarget) => dispatch({ type: 'open', tab: { kind: 'file', title: fileTabTitle(target), target } }),
    [dispatch],
  );
  const openTab = useCallback((tab: PaneTabSpec) => dispatch({ type: 'open', tab }), [dispatch]);

  const value = useMemo<PaneContextValue>(
    () => ({ state, dispatch, openFile, openTab }),
    [state, dispatch, openFile, openTab],
  );

  usePhoneBack(state.open, hide);

  // ⋯ (id null) acts on the active tab; a right-click acts on the tab clicked.
  const openMenu = useCallback(
    (id: string | null) => {
      const target = id ?? state.activeId;
      setMenuFor((cur) => (target === null || cur === target ? null : target));
    },
    [state.activeId],
  );

  const menuId = menuFor !== null && state.tabs.some((t) => t.id === menuFor) ? menuFor : null;
  const menuIndex = menuId === null ? -1 : state.tabs.findIndex((t) => t.id === menuId);
  const active = state.tabs.find((t) => t.id === state.activeId) ?? null;

  const pane = state.open ? (
    <FilePane docked={docked} menuOpen={menuId !== null} onHide={hide}>
      <div className="relative shrink-0">
        <PaneTabStrip
          tabs={state.tabs}
          activeId={state.activeId}
          menuOpen={menuId !== null}
          onActivate={activate}
          onClose={closeTab}
          onMenu={openMenu}
          onBack={hide}
        />
        {menuId !== null && (
          <PaneTabMenu
            hasOthers={state.tabs.length > 1}
            hasRight={menuIndex >= 0 && menuIndex < state.tabs.length - 1}
            canReopen={state.closed.length > 0}
            onClose={() => act({ type: 'close', id: menuId })}
            onCloseOthers={() => act({ type: 'closeOthers', id: menuId })}
            onCloseRight={() => act({ type: 'closeRight', id: menuId })}
            onReopen={() => act({ type: 'reopen' })}
            onDismiss={dismissMenu}
          />
        )}
      </div>
      <PaneBody tab={active} onHide={hide} onCloseTab={closeTab} onRetitle={retitle} onSendText={onSendText} />
    </FilePane>
  ) : null;

  const withContext = (inner: ReactNode) => (
    <FilePreviewContext.Provider value={openFile}>
      <PaneContext.Provider value={value}>{inner}</PaneContext.Provider>
    </FilePreviewContext.Provider>
  );

  if (!docked) {
    return withContext(
      <>
        {children}
        {pane}
      </>,
    );
  }
  return withContext(
    <div className="flex h-full w-full min-h-0 min-w-0">
      <div className="h-full min-h-0 min-w-0 flex-1">{children}</div>
      {pane}
    </div>,
  );
}

/** The pane's shell: position, width, the drag handle and Escape to hide. */
function FilePane({
  docked,
  menuOpen,
  onHide,
  children,
}: {
  docked: boolean;
  menuOpen: boolean;
  onHide: () => void;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(readWidth);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While the tab menu is open, Escape closes the menu, not the pane.
      if (e.key === 'Escape' && !menuOpen) onHide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onHide, menuOpen]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = { startX: e.clientX, startWidth: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    // The handle is on the pane's left edge: dragging left widens it.
    const next = drag.current.startWidth + (drag.current.startX - e.clientX);
    setWidth(Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(next))));
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      // Not remembered across reloads; the pane still works.
    }
  };

  return (
    <aside
      role="dialog"
      aria-label="Preview pane"
      style={{ '--pane-w': `max(320px, min(${width}px, calc(100vw - ${MIN_PAGE_WIDTH}px)))` } as CSSProperties}
      className={cn(
        'z-[90] flex flex-col border-l border-border bg-card animate-in slide-in-from-right duration-200',
        // A phone always gets the full-screen page. 100dvh, not 100vh: the
        // browser's address bar changes the visible height.
        'fixed inset-0 h-[100dvh] w-full',
        docked
          ? 'md:relative md:inset-auto md:z-auto md:h-full md:w-[var(--pane-w)] md:shrink-0'
          : 'sm:inset-y-0 sm:left-auto sm:right-0 sm:h-auto sm:w-[var(--pane-w)] sm:shadow-2xl',
      )}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize preview"
        title="Drag to resize"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cn(
          'absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize touch-none',
          'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent after:transition-colors hover:after:bg-primary/50',
          docked ? 'md:block' : 'sm:block',
        )}
      />
      {children}
    </aside>
  );
}
