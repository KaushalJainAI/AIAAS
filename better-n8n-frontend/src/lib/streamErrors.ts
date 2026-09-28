/**
 * What the chat says when the request itself fails — before or while the
 * server streams a turn — as opposed to a model failing, which the backend
 * already explains (`llm/access.py::explain_provider_failure`).
 *
 * These were shown as-is: "Stream request failed: 502" during every deploy,
 * "Failed to fetch" when the network dropped, a proxy's HTML page. Each case
 * says what happened and what to do. A sentence the server wrote on purpose
 * (the input sanitizer, the content policy, a missing credential) is kept.
 */

const GENERIC = /^Stream request failed: \d+$/;

function serverSentence(message: string): boolean {
  const m = message.trim();
  return m !== '' && !GENERIC.test(m) && !m.startsWith('<') && !m.startsWith('{');
}

export function describeStreamFailure(status: number | undefined, message: string | undefined): string {
  const text = (message ?? '').trim();
  const lower = text.toLowerCase();

  if (status === undefined || status === 0) {
    if (lower.includes('failed to fetch') || lower.includes('networkerror')
        || lower.includes('network error') || lower.includes('load failed')
        || lower.includes('input stream') || lower.includes('network')) {
      return typeof navigator !== 'undefined' && navigator.onLine === false
        ? 'You appear to be offline. Reconnect and send your message again.'
        : 'The connection to the server dropped. If the answer was already on its way it may still finish — reopen the chat in a moment. Otherwise, send your message again.';
    }
    return text || 'Something went wrong while sending. Send your message again.';
  }

  if (serverSentence(text)) return text;

  if (status === 401) return 'Your sign-in has expired. Sign in again, then send your message.';
  if (status === 403) return 'You do not have access to this conversation.';
  if (status === 404) return 'This conversation no longer exists. Start a new chat.';
  if (status === 413) return 'That message or attachment is too large to send. Shorten it or attach a smaller file.';
  if (status === 429) return 'You are sending messages faster than allowed. Wait a moment, then send again.';
  if (status === 502 || status === 503 || status === 504) {
    return 'The server is restarting or busy right now, so your message was not sent. Wait a few seconds and send it again.';
  }
  if (status >= 500) return 'The server hit an error before answering, so your message was not sent. Send it again; if it keeps happening, start a new chat.';
  return `The request was refused (HTTP ${status}). Send your message again.`;
}
