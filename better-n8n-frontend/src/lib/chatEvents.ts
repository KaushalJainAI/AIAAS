/**
 * Window events between the notification socket and an open chat.
 *
 * A worker's result can be written into a conversation after the turn that
 * started it ended (`Backend/chat/tools/tasks.py::post_run_result`). Its
 * notification names the chat; the socket hook announces it here, and the
 * chat page, if it is showing that conversation, reloads it.
 */
export const CHAT_SESSION_UPDATED_EVENT = 'aiaas:chat-session-updated';

export function announceChatSessionUpdated(sessionId: string): void {
  window.dispatchEvent(new CustomEvent(CHAT_SESSION_UPDATED_EVENT, { detail: { sessionId } }));
}
