import { useEffect, useState } from 'react';

import { ApiError } from '../../api/client';

/** How long typing waits before a search is sent. Same as the web (`lib/documentSearch.ts`). */
export const SEARCH_DEBOUNCE_MS = 250;

/** How long a sheet waits to leave before the next one opens: two modals cannot present at once. */
export const SHEET_HANDOFF_MS = 280;

export function handoff(next: () => void): void {
  setTimeout(next, SHEET_HANDOFF_MS);
}

/** The server's sentence for a failed request, or the fallback. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function isStorageFull(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'STORAGE_FULL';
}

/** A value that follows the input after `ms` of quiet. */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** A count with its noun, as the web writes it: "1 file", "2 files". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
