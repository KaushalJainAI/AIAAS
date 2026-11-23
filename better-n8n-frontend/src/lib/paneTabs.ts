/**
 * The tabs of the side pane, as pure data.
 *
 * No React and no DOM here, so vitest can test every rule. The pane
 * (`components/pane/SidePane.tsx`) holds one `PaneState` in a reducer and
 * draws it. Opening a file adds a tab, or focuses the one already open,
 * instead of replacing what is there.
 *
 * Every kind has a body. A `browser` tab holds the calls of one run of the
 * agent's browser (`views`, newest last). The chat keeps it current while the
 * turn runs (`browserState`). Views are small (no pictures), but they are not
 * persisted: `writePersisted` keeps file tabs only.
 */

import type { FileTarget } from '@/components/files/filePreviewState';
import type { BrowserView } from '@/api/browser';

export const MAX_TABS = 8;
export const MAX_CLOSED = 5;

type TabBase = { id: string; title: string };

export type PaneTab =
  | (TabBase & { kind: 'file'; target: FileTarget; nonce: number })
  /**
   * `runKey` names the run this tab shows: `live<turnSeq>` while a turn is
   * streaming, `m<messageId>` for a saved answer, `run:<id>` on the runs page.
   * `running` is true while the agent is still using the browser.
   */
  | (TabBase & { kind: 'browser'; runKey: string; views: BrowserView[]; running: boolean })
  /** `srcDoc` is the frame's document, built once by the chat (same sandbox as the chat's own frame). */
  | (TabBase & { kind: 'html'; artifactKey: string; srcDoc: string })
  /** An own-origin picture or video, shown full size. Never a remote URL (see MediaPreview). */
  | (TabBase & { kind: 'media'; mediaType: 'image' | 'video'; src: string })
  /** A link previewed on demand (`POST /api/browser/preview/`). `url` is http(s). */
  | (TabBase & { kind: 'link'; url: string });

type WithoutIds<T> = T extends unknown ? Omit<T, 'id' | 'nonce'> : never;

/** A tab before the pane has given it an id (and a nonce, for files). */
export type PaneTabSpec = WithoutIds<PaneTab>;

export interface PaneState {
  /** Left to right, in the order they were opened. */
  tabs: PaneTab[];
  activeId: string | null;
  /** Whether the pane is visible. Tabs are kept when it is hidden. */
  open: boolean;
  /** Recently closed tabs, newest first, no duplicate ids. */
  closed: PaneTab[];
}

export const EMPTY_PANE: PaneState = { tabs: [], activeId: null, open: false, closed: [] };

export type PaneAction =
  | { type: 'open'; tab: PaneTabSpec } // add, or focus if the same id; opens the pane
  | { type: 'activate'; id: string }
  | { type: 'close'; id: string } // closing the last tab hides the pane
  | { type: 'closeOthers'; id: string }
  | { type: 'closeRight'; id: string }
  | { type: 'reopen' } // pops closed[0]
  | { type: 'hide' } // Escape, Back, the header ×: hide, keep tabs
  | { type: 'show' }
  | { type: 'retitle'; id: string; title: string }
  /** A browser tab's calls and whether the agent is still at it. `views` absent keeps the calls. */
  | { type: 'browserState'; id: string; running: boolean; views?: BrowserView[] }
  | { type: 'restore'; state: PaneState }; // from sessionStorage, sanitised here

/** The id of the browser tab for one run (see `PaneTab`'s `runKey`). */
export function browserTabId(runKey: string): string {
  return `browser:${runKey}`;
}

/**
 * The id comes from the content, so opening the same thing twice focuses the
 * one tab: `file:<documentId>` when there is an id, else `file:path:<path>`.
 */
export function tabIdFor(spec: PaneTabSpec): string {
  switch (spec.kind) {
    case 'file':
      return 'documentId' in spec.target
        ? `file:${spec.target.documentId}`
        : `file:path:${spec.target.path}`;
    case 'browser':
      return browserTabId(spec.runKey);
    case 'html':
      return `html:${spec.artifactKey}`;
    case 'media':
      return `media:${spec.src}`;
    case 'link':
      return `link:${spec.url}`;
  }
}

/** A short tab title for a file target: its name, or "File" until it loads. */
export function fileTabTitle(target: FileTarget): string {
  if ('path' in target && target.path) {
    return target.path.split('/').filter(Boolean).pop() ?? target.path;
  }
  return 'File';
}

/** A downward drag on the tab strip past this many px closes the pane (phones). */
export const SWIPE_CLOSE_PX = 80;

/** Down more than SWIPE_CLOSE_PX and more down than across; a sideways scroll is not a close. */
export function isSwipeDownToClose(dx: number, dy: number): boolean {
  return dy > SWIPE_CLOSE_PX && dy > Math.abs(dx);
}

/** The tab an arrow key moves to: the next one along, or null at either end. */
export function neighbourTabId(tabs: PaneTab[], id: string, step: 1 | -1): string | null {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  return tabs[idx + step]?.id ?? null;
}

/**
 * The tab that takes focus when `id` closes: the right neighbour, else the
 * left one, the same rule `close` uses for the active tab.
 */
export function tabAfterClose(tabs: PaneTab[], id: string): string | null {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  return (tabs[idx + 1] ?? tabs[idx - 1])?.id ?? null;
}

function materialise(spec: PaneTabSpec, id: string, nonce: number): PaneTab {
  return spec.kind === 'file' ? { ...spec, id, nonce } : { ...spec, id };
}

/** Every open of a file tab bumps its nonce, so the body re-reads the file. */
function bump(tab: PaneTab): PaneTab {
  return tab.kind === 'file' ? { ...tab, nonce: tab.nonce + 1 } : tab;
}

/**
 * Opening a tab that is already open. A file re-reads (nonce); a browser run
 * takes the calls it was opened with, so a chip opened later shows the latest.
 */
function refresh(existing: PaneTab, spec: PaneTabSpec): PaneTab {
  if (spec.kind === 'browser' && existing.kind === 'browser') {
    return { ...existing, title: spec.title, views: spec.views, running: spec.running };
  }
  return bump(existing);
}

/** Newest first, no duplicates, at most MAX_CLOSED. */
function addClosed(closed: PaneTab[], tab: PaneTab): PaneTab[] {
  return [tab, ...closed.filter((c) => c.id !== tab.id)].slice(0, MAX_CLOSED);
}

/**
 * Put a tab in the strip and make it active and visible. An existing tab with
 * the same id is replaced in place; a new one goes on the right. At the cap,
 * the leftmost tab that is not active is closed (it goes to `closed`).
 */
function place(state: PaneState, tab: PaneTab): PaneState {
  const closed = state.closed.filter((c) => c.id !== tab.id);
  if (state.tabs.some((t) => t.id === tab.id)) {
    return {
      ...state,
      tabs: state.tabs.map((t) => (t.id === tab.id ? tab : t)),
      activeId: tab.id,
      open: true,
      closed,
    };
  }
  let tabs = state.tabs;
  let nextClosed = closed;
  if (tabs.length >= MAX_TABS) {
    const evict = tabs.findIndex((t) => t.id !== state.activeId);
    if (evict >= 0) {
      nextClosed = addClosed(nextClosed, tabs[evict]);
      tabs = tabs.filter((_, i) => i !== evict);
    }
  }
  return { ...state, tabs: [...tabs, tab], activeId: tab.id, open: true, closed: nextClosed };
}

function openSpec(state: PaneState, spec: PaneTabSpec): PaneState {
  const id = tabIdFor(spec);
  const existing = state.tabs.find((t) => t.id === id);
  return place(state, existing ? refresh(existing, spec) : materialise(spec, id, 1));
}

function close(state: PaneState, id: string): PaneState {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return state;
  const rest = state.tabs.filter((t) => t.id !== id);
  const closed = addClosed(state.closed, state.tabs[idx]);
  if (rest.length === 0) {
    return { ...state, tabs: [], activeId: null, open: false, closed };
  }
  // The active tab's right neighbour takes over, else its left one.
  const activeId =
    state.activeId === id ? (rest[idx] ?? rest[idx - 1]).id : state.activeId;
  return { ...state, tabs: rest, activeId, closed };
}

function closeMany(state: PaneState, id: string, keep: (index: number) => boolean): PaneState {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return state;
  const removed = state.tabs.filter((_, i) => !keep(i));
  if (removed.length === 0) return state;
  // Left to right, so the rightmost removed tab ends up newest.
  const closed = removed.reduce(addClosed, state.closed);
  const tabs = state.tabs.filter((_, i) => keep(i));
  const activeId = tabs.some((t) => t.id === state.activeId) ? state.activeId : id;
  return { ...state, tabs, activeId, closed };
}

/** The first tab with each id, in order. */
function uniqueById(list: PaneTab[]): PaneTab[] {
  const out: PaneTab[] = [];
  for (const t of list) {
    if (!out.some((o) => o.id === t.id)) out.push(t);
  }
  return out;
}

/** Drop what a stored or hand-built state cannot honour, and keep the caps. */
function sanitise(input: PaneState): PaneState {
  const tabs = uniqueById(input.tabs).slice(0, MAX_TABS);
  const closed = uniqueById(input.closed)
    .filter((t) => !tabs.some((x) => x.id === t.id))
    .slice(0, MAX_CLOSED);
  const activeId = tabs.some((t) => t.id === input.activeId)
    ? input.activeId
    : (tabs[tabs.length - 1]?.id ?? null);
  return { tabs, activeId, open: input.open && tabs.length > 0, closed };
}

export function paneReducer(state: PaneState, action: PaneAction): PaneState {
  switch (action.type) {
    case 'open':
      return openSpec(state, action.tab);

    case 'activate':
      if (state.activeId === action.id || !state.tabs.some((t) => t.id === action.id)) return state;
      return { ...state, activeId: action.id };

    case 'close':
      return close(state, action.id);

    case 'closeOthers':
      return closeMany(state, action.id, (i) => state.tabs[i].id === action.id);

    case 'closeRight': {
      const idx = state.tabs.findIndex((t) => t.id === action.id);
      if (idx < 0) return state;
      return closeMany(state, action.id, (i) => i <= idx);
    }

    case 'reopen': {
      const [tab, ...rest] = state.closed;
      if (!tab) return state;
      return place({ ...state, closed: rest }, bump(tab));
    }

    case 'hide':
      return state.open ? { ...state, open: false } : state;

    case 'show':
      return state.open || state.tabs.length === 0 ? state : { ...state, open: true };

    case 'retitle': {
      const tab = state.tabs.find((t) => t.id === action.id);
      if (!tab || tab.title === action.title) return state;
      return { ...state, tabs: state.tabs.map((t) => (t.id === action.id ? { ...t, title: action.title } : t)) };
    }

    case 'browserState': {
      // Only a browser tab that is open takes the update; anything else is a no-op.
      const tab = state.tabs.find((t) => t.id === action.id);
      if (!tab || tab.kind !== 'browser') return state;
      const views = action.views ?? tab.views;
      if (tab.running === action.running && views === tab.views) return state;
      const next: PaneTab = { ...tab, views, running: action.running };
      return { ...state, tabs: state.tabs.map((t) => (t.id === action.id ? next : t)) };
    }

    case 'restore':
      return sanitise(action.state);
  }
}
