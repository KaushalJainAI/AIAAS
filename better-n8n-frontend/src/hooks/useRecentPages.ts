/* Recent pages, from the React side (`lib/recentPages.ts` holds the rules).
 *
 * * `useRecentPages` is the list, re-read when it changes.
 * * `useRecentPagesTracker` counts a visit: 3 seconds on a page, or at once on
 *   the first press or click inside <main>. Leaving the page first cancels it.
 * * `useRecentTitle` lets a page name itself for the list. Otherwise the tab
 *   title is used.
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import {
  RECENT_PAGES_CHANGED_EVENT,
  normalisePath,
  pageTitle,
  readRecentPages,
  record,
  writeRecentPages,
  type RecentPage,
} from '../lib/recentPages';

/** How long someone must stay on a page before it counts. */
export const VISIT_MS = 3000;

/** Titles pages set for themselves, keyed by the stored path. Read when a visit counts. */
const titleOverrides = new Map<string, string>();

export function useRecentPages(): RecentPage[] {
  const [pages, setPages] = useState<RecentPage[]>(readRecentPages);
  useEffect(() => {
    const refresh = () => setPages(readRecentPages());
    window.addEventListener(RECENT_PAGES_CHANGED_EVENT, refresh);
    // Another tab of the same browser may have recorded a visit.
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(RECENT_PAGES_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return pages;
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

function recordVisit(path: string): void {
  const title = titleOverrides.get(path) ?? pageTitle(path, document.title);
  writeRecentPages(record(readRecentPages(), { path, title }, Date.now()));
}

/**
 * Counts the page the shell is showing. `enabled` is false for guests and
 * anyone not signed in, so nothing is written for them.
 */
export function useRecentPagesTracker(pathname: string, search: string, enabled: boolean): void {
  useEffect(() => {
    const path = enabled ? normalisePath(pathname, search) : null;
    if (path === null) return;

    let done = false;
    // One abort stops both listeners and the timer, whichever ends the visit.
    const controller = new AbortController();

    const visit = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      controller.abort();
      recordVisit(path);
    };

    const onUse = (e: Event) => {
      if (e instanceof KeyboardEvent && MODIFIER_KEYS.has(e.key)) return;
      if (e.target instanceof Element && e.target.closest('main')) visit();
    };

    const timer = setTimeout(visit, VISIT_MS);
    const listen = { capture: true, signal: controller.signal };
    document.addEventListener('pointerdown', onUse, listen);
    document.addEventListener('keydown', onUse, listen);

    return () => {
      done = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [pathname, search, enabled]);
}

/**
 * Sets the title this page is listed under. Keyed by the page's path, so it
 * is removed when the page goes away.
 */
export function useRecentTitle(title: string): void {
  const { pathname, search } = useLocation();
  useEffect(() => {
    const path = normalisePath(pathname, search);
    const name = title.trim();
    if (path === null || name === '') return;
    titleOverrides.set(path, name);
    return () => {
      if (titleOverrides.get(path) === name) titleOverrides.delete(path);
    };
  }, [pathname, search, title]);
}
