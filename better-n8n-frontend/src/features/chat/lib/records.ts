/**
 * Session records: messages that are never deleted (H-186).
 *
 * A failed or stopped reply, and an agent's result posted after its turn, are
 * the conversation's log of what happened. The server keeps them through a
 * rewind (`Backend/chat/views.py::delete_message`), so the transcript on
 * screen keeps them too, in place, instead of dropping everything after the
 * point the person rewound to.
 */
import type { ChatMessage } from '../../../api/chat';

export function isRecord(message: Pick<ChatMessage, 'metadata'> | undefined): boolean {
  return Boolean(message?.metadata?.record);
}

/** `messages` cut at `index`, with the records after that point kept. */
export function keepRecords<T extends Pick<ChatMessage, 'metadata'>>(messages: T[], index: number): T[] {
  if (index < 0) return messages;
  return [...messages.slice(0, index), ...messages.slice(index).filter(isRecord)];
}
