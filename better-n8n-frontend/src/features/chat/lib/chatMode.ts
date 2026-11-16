/**
 * Chat autonomy modes: Ask · Auto · Full auto · Plan.
 *
 * Anything the server sends that is not one of these behaves as 'ask', so a
 * payload from before the picker (or a typo) cannot wake up in a looser mode.
 *
 * 'full' (Full auto) skips every approval. It is picked by clicking it or by
 * `/mode full`, and is left out of the Shift+Tab cycle on purpose: nobody
 * should land in the mode that asks about nothing by pressing a key twice.
 */
export type ChatMode = 'ask' | 'auto' | 'full' | 'plan';

export const CHAT_MODES: readonly ChatMode[] = ['ask', 'auto', 'full', 'plan'];

/** What Shift+Tab steps through. Full auto is never reached this way. */
const CYCLE: readonly ChatMode[] = ['ask', 'auto', 'plan'];

export function isChatMode(value: string): value is ChatMode {
  return (CHAT_MODES as readonly string[]).includes(value);
}

/** Normalise a server value into a mode. Unknown (or absent) means 'ask'. */
export function toChatMode(value: unknown): ChatMode {
  const level = String(value ?? '').trim().toLowerCase();
  return isChatMode(level) ? level : 'ask';
}

/** Shift+Tab order: Ask → Auto → Plan → Ask. From Full auto it steps down to Ask. */
export function nextChatMode(current: ChatMode): ChatMode {
  const at = CYCLE.indexOf(current);
  return at < 0 ? 'ask' : CYCLE[(at + 1) % CYCLE.length];
}
