/**
 * Last-opened chat transcript, kept across reloads.
 *
 * The chat page fetches its transcript imperatively, outside react-query, so a
 * reload had nothing to paint and showed a spinner for the length of a round
 * trip. React-query's in-memory cache covers navigating back to the page within
 * a session; this covers the reload, which is the case the user actually
 * notices — the conversation they left is on screen in the first frame and the
 * fetch reconciles behind it.
 *
 * Only the most recent conversation is kept. A transcript is not a database:
 * it is a paint-immediately hint, and holding every thread the user ever opened
 * would trade the whole quota for cache hits on threads they are not looking
 * at. Oversized sessions (long threads, inline HTML artifacts) are skipped
 * entirely rather than evicting something else to fit.
 *
 * Every operation is best-effort. Storage can be disabled outright, full, or
 * hold an entry written by an older shape of `ChatSession`; all three mean "no
 * cache", never a broken page.
 */

import type { ChatSession } from '../api/chat';

/** Shared with `usePersistedState` so all UI-owned keys sort together. */
const PREFIX = 'aiaas_ui:chat.transcript.';

/**
 * Above this, the write is dropped. localStorage caps a whole origin at ~5MB
 * and a `QuotaExceededError` is thrown at the *write*, i.e. at the end of a
 * turn, where it would surface as a failure in the middle of a working chat.
 */
const MAX_BYTES = 1_000_000;

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Blocked by browser privacy settings — accessing it can throw outright.
    return null;
  }
}

/** The cached transcript for `id`, or null if there is nothing usable. */
export function readTranscript(id: string): ChatSession | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatSession;
    // A cache entry that cannot be rendered as a transcript is not a cache hit.
    return Array.isArray(parsed?.messages) ? parsed : null;
  } catch {
    return null;
  }
}

/** Caches `session`, dropping any other conversation held from before. */
export function writeTranscript(session: ChatSession): void {
  const s = store();
  if (!s || !session?.id) return;
  try {
    const serialized = JSON.stringify(session);
    // `length` is UTF-16 units, not bytes — near enough for a ceiling whose
    // job is to stay well clear of the quota rather than to sit against it.
    if (serialized.length > MAX_BYTES) {
      s.removeItem(PREFIX + session.id);
      return;
    }
    prune(s, session.id);
    s.setItem(PREFIX + session.id, serialized);
  } catch {
    // Full or unwritable. The page just loses its head start.
  }
}

/** Drops the cached transcript for `id` — a deleted or abandoned thread. */
export function forgetTranscript(id: string): void {
  const s = store();
  if (!s) return;
  try {
    s.removeItem(PREFIX + id);
  } catch {
    /* nothing to do */
  }
}

/** Removes every cached transcript except `keepId`. */
function prune(s: Storage, keepId: string): void {
  const stale: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (key?.startsWith(PREFIX) && key !== PREFIX + keepId) stale.push(key);
  }
  // Collected first: removing during the walk shifts the indices under it.
  stale.forEach(key => s.removeItem(key));
}
