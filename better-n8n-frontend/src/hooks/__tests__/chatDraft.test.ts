import { describe as group, expect, it, beforeEach } from 'vitest';
import {
  CHAT_DRAFT_MAX_CHARS,
  chatDraftKey,
  clearChatDraft,
  readChatDraft,
  writeChatDraft,
  type DraftStore,
} from '../useChatDraft';

/** Map-backed stand-in for `localStorage`. */
function memStore(): DraftStore & { size: number } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
    get size() { return map.size; },
  };
}

group('chatDraftKey', () => {
  it('namespaces guest and authed drafts apart', () => {
    expect(chatDraftKey('abc', false)).not.toBe(chatDraftKey('abc', true));
  });

  it('gives the unsent box its own key, distinct from any session', () => {
    const fresh = chatDraftKey(undefined, false);
    expect(fresh).not.toBe(chatDraftKey('some-id', false));
    // …but stable across renders, so typing before the first send accumulates.
    expect(chatDraftKey(undefined, false)).toBe(fresh);
  });
});

group('readChatDraft / writeChatDraft', () => {
  let store: DraftStore & { size: number };

  beforeEach(() => {
    store = memStore();
  });

  it('round-trips text', () => {
    const key = chatDraftKey('conv-1', false);
    writeChatDraft(store, key, 'half a thought…');
    expect(readChatDraft(store, key)).toBe('half a thought…');
  });

  it('returns empty for a conversation with no draft', () => {
    expect(readChatDraft(store, chatDraftKey('never-typed', false))).toBe('');
  });

  it('removes the entry when the box is cleared, rather than storing empties', () => {
    const key = chatDraftKey('conv-1', false);
    writeChatDraft(store, key, 'something');
    expect(store.size).toBe(1);
    writeChatDraft(store, key, '');
    expect(store.size).toBe(0);
    expect(readChatDraft(store, key)).toBe('');
  });

  it('keeps one draft per conversation without cross-talk', () => {
    writeChatDraft(store, chatDraftKey('a', false), 'draft for A');
    writeChatDraft(store, chatDraftKey('b', false), 'draft for B');
    expect(readChatDraft(store, chatDraftKey('a', false))).toBe('draft for A');
    expect(readChatDraft(store, chatDraftKey('b', false))).toBe('draft for B');
  });

  it('caps an oversized paste instead of refusing it', () => {
    const key = chatDraftKey('conv-1', false);
    writeChatDraft(store, key, 'x'.repeat(CHAT_DRAFT_MAX_CHARS + 500));
    expect(readChatDraft(store, key)).toHaveLength(CHAT_DRAFT_MAX_CHARS);
  });

  it('ignores a non-string entry left by an older shape', () => {
    const key = chatDraftKey('conv-1', false);
    store.setItem(key, null as unknown as string);
    expect(readChatDraft(store, key)).toBe('');
  });
});

group('clearChatDraft', () => {
  it('drops only the deleted conversation’s draft', () => {
    const store = memStore();
    writeChatDraft(store, chatDraftKey('gone', false), 'unsent');
    writeChatDraft(store, chatDraftKey('stays', false), 'keep me');
    clearChatDraft('gone', false, store);
    expect(readChatDraft(store, chatDraftKey('gone', false))).toBe('');
    expect(readChatDraft(store, chatDraftKey('stays', false))).toBe('keep me');
  });
});
