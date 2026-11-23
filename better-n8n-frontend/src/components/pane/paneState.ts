/**
 * The side pane's React context, and its sessionStorage copy.
 *
 * Only the context and plain functions live here, no component, so that
 * `SidePane.tsx` exports only a component (fast refresh needs that).
 *
 * The saved state is per conversation (`pane:<conversationId>`). Only the
 * tabs are saved, never `open`: a reload must not cover the chat on a phone.
 */

import { createContext, useContext } from 'react';

import type { FileTarget } from '@/components/files/filePreviewState';
import { EMPTY_PANE, paneReducer, type PaneAction, type PaneState, type PaneTab, type PaneTabSpec } from '@/lib/paneTabs';

export interface PaneContextValue {
  state: PaneState;
  dispatch: (action: PaneAction) => void;
  /** What `useFilePreview()` hands out: a file opens as a tab. */
  openFile: (target: FileTarget) => void;
  openTab: (tab: PaneTabSpec) => void;
}

export const PaneContext = createContext<PaneContextValue | null>(null);

/** The pane's context, or null outside a `SidePane`. */
export function usePane(): PaneContextValue | null {
  return useContext(PaneContext);
}

function isFileTab(value: unknown): value is PaneTab {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  if (t.kind !== 'file' || typeof t.id !== 'string' || typeof t.title !== 'string') return false;
  if (typeof t.nonce !== 'number') return false;
  const target = t.target as Record<string, unknown> | undefined;
  return (
    !!target &&
    typeof target === 'object' &&
    (typeof target.documentId === 'number' || typeof target.path === 'string')
  );
}

/** Only file tabs have a body in this phase, so only they are restored. */
function parse(raw: unknown): PaneState {
  if (!raw || typeof raw !== 'object') return EMPTY_PANE;
  const r = raw as Record<string, unknown>;
  const tabs = Array.isArray(r.tabs) ? r.tabs.filter(isFileTab) : [];
  const closed = Array.isArray(r.closed) ? r.closed.filter(isFileTab) : [];
  return {
    tabs,
    closed,
    activeId: typeof r.activeId === 'string' ? r.activeId : null,
    open: false,
  };
}

/** The saved tabs for a conversation, with the pane hidden. Empty when unavailable. */
export function readPersisted(storageKey: string | undefined): PaneState {
  if (!storageKey) return EMPTY_PANE;
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return EMPTY_PANE;
    return paneReducer(EMPTY_PANE, { type: 'restore', state: parse(JSON.parse(raw)) });
  } catch {
    // Storage blocked or the saved text is not JSON: start with no tabs.
    return EMPTY_PANE;
  }
}

/**
 * Only file tabs are saved: `parse` restores nothing else, and an html tab
 * carries a whole document that would fill sessionStorage for no reason.
 */
export function writePersisted(storageKey: string, state: PaneState): void {
  const fileOnly = (tabs: PaneTab[]) => tabs.filter((t) => t.kind === 'file');
  const activeId = state.tabs.find((t) => t.id === state.activeId)?.kind === 'file' ? state.activeId : null;
  try {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ tabs: fileOnly(state.tabs), activeId, closed: fileOnly(state.closed) }),
    );
  } catch {
    // Not remembered across reloads; the pane still works.
  }
}

/** True on a phone, where the pane is a full-screen page. False when unknown. */
export function isPhone(): boolean {
  try {
    return window.matchMedia('(max-width: 767px)').matches;
  } catch {
    return false;
  }
}
