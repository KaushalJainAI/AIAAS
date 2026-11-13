import { ApiError } from '../../api/client';

/**
 * The server's own sentence when it sent one (DRF `detail`, a field error, or
 * an `error` key), else the screen's fallback. Network failures and anything
 * that is not an API answer get the fallback, never a raw JS message.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.message.trim()) return err.message;
  return fallback;
}

/**
 * Like `errorMessage`, but also keeps a sentence a flow threw on purpose (an
 * `Error` written for the user, such as the OAuth return checks). Use it only
 * where the thrown text was written for display.
 */
export function sentenceOf(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.message.trim()) return err.message;
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}
