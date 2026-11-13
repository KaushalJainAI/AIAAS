/**
 * Chat autonomy modes: Ask · Auto · Plan · Full auto. Port of
 * better-n8n-frontend/src/lib/chatMode.ts, with the same rules: anything the
 * server sends that is not a mode behaves as 'ask', and Full auto is never
 * reached by stepping through the modes. On a phone there is no Shift+Tab, so
 * the tap-to-step cycle keeps the web's rule: a tap on the mode chip must not
 * land anyone in the mode that asks about nothing.
 */
export type ChatMode = 'ask' | 'auto' | 'full' | 'plan';

export const CHAT_MODES: readonly ChatMode[] = ['ask', 'auto', 'full', 'plan'];

/** The rungs a chip taps through. Full auto is picked from the sheet, never by stepping. */
const CYCLE: readonly ChatMode[] = ['ask', 'auto', 'plan'];

export function isChatMode(value: string): value is ChatMode {
  return (CHAT_MODES as readonly string[]).includes(value);
}

/** Normalise a server value into a mode. Unknown (or absent) means 'ask'. */
export function toChatMode(value: unknown): ChatMode {
  const level = String(value ?? '').trim().toLowerCase();
  return isChatMode(level) ? level : 'ask';
}

/** Ask, then Auto, then Plan, then Ask again. From Full auto it steps down to Ask. */
export function nextChatMode(current: ChatMode): ChatMode {
  const at = CYCLE.indexOf(current);
  return at < 0 ? 'ask' : CYCLE[(at + 1) % CYCLE.length];
}

export const MODE_LABEL: Record<ChatMode, string> = {
  ask: 'Ask',
  auto: 'Auto',
  full: 'Full auto',
  plan: 'Plan',
};

/** What each mode does, in the words the mode sheet shows. */
export const MODE_HINT: Record<ChatMode, string> = {
  ask: 'Asks before anything that changes something outside this chat.',
  auto: 'A reviewer lets clear, reversible steps through. Anything risky still asks.',
  plan: 'Looks and plans. Nothing is changed.',
  full: 'Approves nothing for this chat. Use only when you trust the request.',
};
