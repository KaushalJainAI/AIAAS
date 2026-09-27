/**
 * `useState` that remembers its value across page switches.
 *
 * Navigating between routes unmounts a page entirely, so anything held in
 * local component state (which tab was open, which filter was applied, what
 * was typed in a search box) is lost the moment the user looks at something
 * else and comes back. This is the drop-in replacement for those cases.
 *
 * Two backing stores, because the two kinds of state expire differently:
 *   - `local`   — preferences the user chose deliberately (tab, sort, view
 *                 mode). They should still be there tomorrow.
 *   - `session` — incidental context (a search query, a scroll position).
 *                 Worth keeping while the tab is open, stale after that.
 *
 * Values round-trip through JSON, so anything stored must be serialisable.
 * A read that fails (disabled storage, corrupted entry, a shape that no
 * longer type-checks) falls back to the initial value rather than throwing —
 * persisted UI state is never important enough to break a page over.
 */

import { useEffect, useRef, useState } from 'react';

export type PersistedStorage = 'local' | 'session';

const PREFIX = 'aiaas_ui:';

function backingStore(kind: PersistedStorage): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    // Storage can throw outright when blocked by browser privacy settings.
    return null;
  }
}

function read<T>(kind: PersistedStorage, key: string): { value: T } | null {
  const store = backingStore(kind);
  if (!store) return null;
  try {
    const raw = store.getItem(PREFIX + key);
    if (raw === null) return null;
    return { value: JSON.parse(raw) as T };
  } catch {
    return null;
  }
}

interface Options<T> {
  /** Where to keep it. Defaults to `local`. */
  storage?: PersistedStorage;
  /**
   * Rejects a stored value that is no longer valid — an option that has since
   * been removed, a tab id that was renamed. Rejected values fall back to the
   * initial one and the stale entry is overwritten on the next write.
   */
  validate?: (value: unknown) => value is T;
}

export function usePersistedState<T>(
  key: string,
  initialValue: T,
  options: Options<T> = {},
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const { storage = 'local', validate } = options;

  // Read once, during the initial render, so the page paints with the
  // remembered value instead of flashing the default and then correcting.
  const [value, setValue] = useState<T>(() => {
    const stored = read<T>(storage, key);
    if (!stored) return initialValue;
    if (validate && !validate(stored.value)) return initialValue;
    return stored.value;
  });

  // Skip the write on the first render: it would only rewrite what we just
  // read, and would clobber a valid entry with the default when storage is
  // unavailable for reads but not writes.
  const hydrated = useRef(false);

  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    const store = backingStore(storage);
    if (!store) return;
    try {
      store.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // Quota exceeded, or storage disabled mid-session. Nothing to do.
    }
  }, [key, storage, value]);

  return [value, setValue];
}
