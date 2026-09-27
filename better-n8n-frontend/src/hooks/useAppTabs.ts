/**
 * Open files as tabs, one list per app.
 *
 * Two copies, for two different jobs. `sessionStorage` is the fast one: it
 * draws the strip on the first paint and keeps two browser tabs of one app
 * independent. The server (`api/recents.ts` app sessions) is the durable
 * one: it is what a new window, a restarted browser or another device
 * restores from, the way a desktop app reopens the files it had open.
 *
 * The server copy is read only when this browser tab has no list of its own
 * (`sessionStorage` empty for the app), so a restore never overwrites tabs
 * someone is working in. It is written, debounced, only after that read has
 * settled, so an empty first render cannot wipe the saved session before it
 * was restored. `restoredActive` is the file that was in front last time,
 * for the workspace to reopen when the URL names none.
 *
 * `?file=<id>` is the active tab — a link from Files or a chat card lands on
 * the right tab, and Back works. Opening a file adds it to the list;
 * closing removes it. The list is capped (20) so a long session cannot grow
 * it without bound. Names ride beside the ids so a tab labels itself without
 * a fetch for files past the first page.
 *
 * Unsaved work never sits on a background tab: switching away from a dirty
 * file goes through the unsaved-changes dialog first (Save / Don't save /
 * Cancel), so a tab left behind is always saved or deliberately discarded.
 * The dot therefore marks the active tab while it is dirty.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { recentsService } from '../api/recents';

export interface AppTab {
  id: number;
  name: string;
}

const MAX_TABS = 20;
const SYNC_DELAY_MS = 1000;

function keyFor(appId: string) {
  return `app-tabs:${appId}`;
}

/** The stored list, or null when this browser tab has none for the app. */
function read(appId: string): AppTab[] | null {
  try {
    const raw = sessionStorage.getItem(keyFor(appId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is AppTab =>
        !!t && Number.isInteger(t.id) && typeof t.name === 'string',
    );
  } catch {
    return null;
  }
}

function store(appId: string, tabs: AppTab[]) {
  try {
    sessionStorage.setItem(keyFor(appId), JSON.stringify(tabs));
  } catch {
    // A full or blocked storage costs the tab list, never the file.
  }
}

export function useAppTabs(appId: string, active: AppTab | null) {
  // The workspace is keyed by app, so one initializer per app is enough —
  // no effect is needed to pick the list back up.
  const [initial] = useState(() => read(appId));
  const [tabs, setTabs] = useState<AppTab[]>(() => initial ?? []);
  // With a local list there is nothing to restore, so syncing starts at once.
  const [hydrated, setHydrated] = useState(initial !== null);
  const [restoredActive, setRestoredActive] = useState<number | null>(null);

  // Restore from the server when this browser tab has no list of its own.
  useEffect(() => {
    if (initial !== null) return;
    let cancelled = false;
    recentsService
      .session(appId)
      .then((saved) => {
        if (cancelled) return;
        if (saved.tabs.length > 0) {
          setTabs((prev) => {
            const merged = [...prev];
            for (const t of saved.tabs) {
              if (!merged.some((m) => m.id === t.id)) merged.push({ id: t.id, name: t.name });
            }
            const next = merged.slice(0, MAX_TABS);
            store(appId, next);
            return next;
          });
          setRestoredActive(saved.active);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [appId, initial]);

  // The active file is always a tab, and its name follows renames.
  // Returning `prev` when nothing changed keeps this loop-free even when the
  // caller builds a fresh `active` object every render; `sessionStorage` is
  // the external system this synchronises with.
  useEffect(() => {
    if (active === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTabs((prev) => {
      const i = prev.findIndex((t) => t.id === active.id);
      if (i === 0 && prev[0].name === active.name) return prev;
      const next = [
        { id: active.id, name: active.name },
        ...prev.filter((t) => t.id !== active.id),
      ].slice(0, MAX_TABS);
      store(appId, next);
      return next;
    });
  }, [appId, active]);

  // Save to the server, debounced, once the restore has settled. Keyed on the
  // ids and the active id, so a rename (which the server resolves itself)
  // does not trigger a write.
  const activeId = active?.id ?? null;
  const signature = `${tabs.map((t) => t.id).join(',')}|${activeId ?? ''}`;
  const lastSaved = useRef<string | null>(null);
  // What is waiting for the debounce, so leaving the app still saves it.
  const unsaved = useRef<{ ids: number[]; active: number | null } | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    if (lastSaved.current === null) {
      // The first settled state is what was just restored or read: nothing new.
      lastSaved.current = signature;
      return;
    }
    if (lastSaved.current === signature) return;
    unsaved.current = { ids: tabs.map((t) => t.id), active: activeId };
    const t = window.setTimeout(() => {
      const next = unsaved.current;
      unsaved.current = null;
      lastSaved.current = signature;
      if (next) void recentsService.saveSession(appId, next.ids, next.active).catch(() => undefined);
    }, SYNC_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [appId, hydrated, signature, tabs, activeId]);

  useEffect(
    () => () => {
      const next = unsaved.current;
      unsaved.current = null;
      if (next) void recentsService.saveSession(appId, next.ids, next.active).catch(() => undefined);
    },
    [appId],
  );

  const close = useCallback(
    (id: number) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t !== undefined && t.id !== id);
        if (next.length === prev.length) return prev;
        store(appId, next);
        return next;
      });
    },
    [appId],
  );

  return { tabs, close, restoredActive };
}
