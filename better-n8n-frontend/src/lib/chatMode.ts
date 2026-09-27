/**
 * Chat autonomy modes: Ask · Auto · Plan.
 *
 * 'full' is never a chat mode — it stays an agent-builder choice. Anything
 * the server sends that is not one of these behaves as 'ask', so a payload
 * from before the picker (or a typo) cannot wake up in a looser mode.
 */
export type ChatMode = 'ask' | 'auto' | 'plan';

export const CHAT_MODES: readonly ChatMode[] = ['ask', 'auto', 'plan'];

/** Normalise a server value into a mode. Unknown (or absent) means 'ask'. */
export function toChatMode(value: unknown): ChatMode {
  const level = String(value ?? '').trim().toLowerCase();
  return level === 'auto' || level === 'plan' ? level : 'ask';
}

/** Shift+Tab order: Ask → Auto → Plan → Ask. */
export function nextChatMode(current: ChatMode): ChatMode {
  const at = CHAT_MODES.indexOf(current);
  return CHAT_MODES[(at + 1) % CHAT_MODES.length];
}
