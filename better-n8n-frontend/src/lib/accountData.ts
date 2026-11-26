/**
 * What this browser keeps about one account's conversations, and when it is
 * forgotten.
 *
 * The chat keeps a little of a signed-in person's content in the browser so a
 * reload paints at once: the last open conversation (`chat.lastSessionId`), a
 * copy of its transcript (`chat.transcript.<id>`), unsent drafts
 * (`chat.draft:auth:<id>`) and the side pane's tabs (`pane:<id>` in
 * sessionStorage). None of it was tied to the account. Sign-out cleared only
 * the tokens, so the next person to sign in on the same browser had the
 * previous person's conversation painted from the cache before the server
 * refused it (2026-11-17).
 *
 * Two doors, both best-effort (storage may be blocked or full):
 *
 * - `forgetAccountData()` on sign-out.
 * - `claimAccountData(userId)` whenever a user is known (sign-in, and the
 *   profile read on a reload). It runs before the pages render, so a
 *   different account than the one that wrote the data finds nothing. This
 *   also covers a session that ended without a sign-out (an expired token,
 *   a closed tab).
 *
 * Preferences (theme, chosen model, switches) are not content and are kept.
 */

const UI = 'aiaas_ui:';
const OWNER_KEY = `${UI}account`;

/** localStorage keys (after the prefix) that hold one account's content. */
const LOCAL_PREFIXES = [`${UI}chat.transcript.`, `${UI}chat.draft:auth:`];
// `recentPages` is the Cmd+K "Recent" list (lib/recentPages.ts): the next
// account on this browser must not see the places this one used.
const LOCAL_KEYS = [`${UI}chat.lastSessionId`, `${UI}recentPages`];
/** sessionStorage keys that hold one account's content. */
const SESSION_PREFIXES = ['pane:'];

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function sweep(s: Storage | null, prefixes: string[], keys: string[] = []): void {
  if (!s) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (key && (keys.includes(key) || prefixes.some((p) => key.startsWith(p)))) doomed.push(key);
    }
    // Collected first: removing during the walk shifts the indices.
    doomed.forEach((key) => s.removeItem(key));
  } catch {
    // Nothing more can be done without storage.
  }
}

/** Removes every conversation-shaped thing this browser holds for an account. */
export function forgetAccountData(): void {
  sweep(storage('local'), LOCAL_PREFIXES, [...LOCAL_KEYS, OWNER_KEY]);
  sweep(storage('session'), SESSION_PREFIXES);
}

/**
 * Marks the stored content as `userId`'s, first forgetting it if another
 * account (or an unknown one, from before this existed) wrote it.
 */
export function claimAccountData(userId: number | string): void {
  const s = storage('local');
  if (!s) return;
  const id = String(userId);
  let owner: string | null;
  try {
    owner = s.getItem(OWNER_KEY);
  } catch {
    return;
  }
  if (owner === id) return;
  forgetAccountData();
  try {
    s.setItem(OWNER_KEY, id);
  } catch {
    // Unwritable: the next claim forgets again, which is the safe side.
  }
}
