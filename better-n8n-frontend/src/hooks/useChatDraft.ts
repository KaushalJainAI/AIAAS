import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The composer's unsent text, kept per conversation.
 *
 * Typing half a message, opening another thread and coming back used to find
 * an empty box: `input` was plain component state, so switching conversations
 * (or leaving the page) discarded it. Each conversation now owns its draft —
 * keyed by session id, with `__new__` for the not-yet-created one and a
 * guest/auth namespace so the two never share a box.
 *
 * Backed by `localStorage` rather than component state alone, so a reload
 * keeps the text too. Empty drafts are removed rather than stored, so the
 * store only ever holds conversations with something actually unsent.
 */

const PREFIX = 'aiaas_ui:';
const NEW_CONVERSATION = '__new__';

/** Longest draft worth keeping. A composer holding more than this is a paste
    that was never sent; capping bounds one localStorage entry. */
export const CHAT_DRAFT_MAX_CHARS = 20000;

/** Minimal shape of what the draft store needs. `Storage` satisfies it, and
    tests hand in a Map-backed fake. */
export interface DraftStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStore(): DraftStore | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    // Storage blocked by browser privacy settings.
    return null;
  }
}

/** Storage key for one conversation's draft. Guest and authed boxes are
    separate namespaces: a guest draft must never paint into a signed-in
    thread, or vice versa. */
export function chatDraftKey(
  conversationId: string | undefined,
  isGuest: boolean,
): string {
  return `${PREFIX}chat.draft:${isGuest ? 'guest' : 'auth'}:${conversationId ?? NEW_CONVERSATION}`;
}

export function readChatDraft(store: DraftStore | null, key: string): string {
  if (!store) return '';
  try {
    const raw = store.getItem(key);
    if (typeof raw !== 'string' || raw === '') return '';
    return raw.length > CHAT_DRAFT_MAX_CHARS ? raw.slice(0, CHAT_DRAFT_MAX_CHARS) : raw;
  } catch {
    return '';
  }
}

export function writeChatDraft(store: DraftStore | null, key: string, value: string): void {
  if (!store) return;
  try {
    if (!value) {
      store.removeItem(key);
      return;
    }
    store.setItem(
      key,
      value.length > CHAT_DRAFT_MAX_CHARS ? value.slice(0, CHAT_DRAFT_MAX_CHARS) : value,
    );
  } catch {
    // Quota exceeded or storage disabled mid-session. The text is still in
    // component state for this visit; only the reload restore is lost.
  }
}

/** Drops the stored draft for a conversation — used when the conversation
    itself is deleted, so a removed thread leaves no text behind. */
export function clearChatDraft(
  conversationId: string | undefined,
  isGuest: boolean,
  store: DraftStore | null = defaultStore(),
): void {
  if (!store) return;
  try {
    store.removeItem(chatDraftKey(conversationId, isGuest));
  } catch {
    // Nothing to do.
  }
}

/**
 * `useState` for the composer, with one saved string per conversation.
 *
 * The returned setter has the same signature as a `useState` setter
 * (including functional updates), so call sites do not change. Every write
 * goes to both state and the store synchronously — the ref is the source of
 * truth for persistence, which keeps rapid keystrokes and functional updates
 * correct without a debounced effect that could fire after a switch and
 * clobber the newly opened conversation's text.
 */
export function useChatDraft(
  conversationId: string | undefined,
  isGuest: boolean,
): [string, React.Dispatch<React.SetStateAction<string>>] {
  // Resolved once: the same `localStorage` object for the life of the hook,
  // so a render never observes a different store halfway through.
  const [store] = useState<DraftStore | null>(() => defaultStore());

  const key = chatDraftKey(conversationId, isGuest);
  const [input, setInputState] = useState<string>(() => readChatDraft(store, key));

  const keyRef = useRef(key);
  const inputRef = useRef(input);

  // Conversation switch: park the old box's text under the old key, then
  // paint the new conversation's draft. Runs before any write for the new
  // key because writes go through `setInput` below, which uses `keyRef`.
  useEffect(() => {
    if (keyRef.current === key) return;
    writeChatDraft(store, keyRef.current, inputRef.current);
    keyRef.current = key;
    const next = readChatDraft(store, key);
    inputRef.current = next;
    setInputState(next);
  }, [key, store]);

  const setInput = useCallback<React.Dispatch<React.SetStateAction<string>>>((action) => {
    const next = typeof action === 'function'
      ? (action as (prev: string) => string)(inputRef.current)
      : action;
    inputRef.current = next;
    writeChatDraft(store, keyRef.current, next);
    setInputState(next);
  }, [store]);

  return [input, setInput];
}
