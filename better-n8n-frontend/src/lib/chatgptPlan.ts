/**
 * What the ChatGPT plan panel shows, as a pure function of what the server
 * said and whether a sign-in popup is open. Kept out of the component so the
 * four states can be tested without a browser.
 */
import type { ChatGPTPlanStatus } from '../api/chatgptPlan';

export type PlanView = 'hidden' | 'connect' | 'waiting' | 'reconnect' | 'connected';

export function planView(status: ChatGPTPlanStatus | null, waiting: boolean): PlanView {
  // No answer yet, or switched off on this server: draw nothing. A disabled
  // button would advertise something this install cannot do.
  if (!status || !status.enabled) return 'hidden';
  if (status.connected) return 'connected';
  if (waiting) return 'waiting';
  return status.needs_sign_in ? 'reconnect' : 'connect';
}

/** How long a sign-in popup is watched before the panel stops waiting. */
export const SIGN_IN_WAIT_MS = 5 * 60 * 1000;
export const SIGN_IN_POLL_MS = 2000;

/** The server's sentence from a failed call, or a plain fallback. */
export function planErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { error?: unknown } } })?.response?.data;
  if (typeof data?.error === 'string' && data.error) return data.error;
  return 'Could not start the ChatGPT sign-in. Try again.';
}
