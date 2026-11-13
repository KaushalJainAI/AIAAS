/**
 * The app's side of the OAuth round trip: the `state` it sends, and reading the
 * URL the browser session returns with.
 *
 * `state` marks a request as started by the app. The website reads that mark
 * and hands the result back to `aiaas://` (see better-n8n-frontend/src/lib/appHandoff.ts).
 * It is also the app's own check: a return whose state is not the one the app
 * sent is refused.
 */

import * as Crypto from 'expo-crypto';

export const APP_STATE_PREFIX = 'app.';

/**
 * A fresh app state: the prefix, then 32 hex characters of secure randomness.
 *
 * The randomness comes from the OS through `expo-crypto`: a predictable state
 * would let another app or page inject a code.
 */
export function newAppState(): string {
  const bytes = Crypto.getRandomBytes(16);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${APP_STATE_PREFIX}${hex}`;
}

/** The parameters the website hands back: `code`, `state` and `error`. */
export interface ReturnParams {
  code?: string;
  state?: string;
  error?: string;
}

/**
 * Reads the query of a return URL such as `aiaas://auth?code=…&state=…`.
 *
 * Written by hand: the native URL class is partial in React Native, and the
 * only three keys this reads are simple. Values are percent-decoded.
 */
export function readReturnParams(url: string): ReturnParams {
  const queryAt = url.indexOf('?');
  if (queryAt < 0) return {};
  const query = url.slice(queryAt + 1).split('#')[0];
  const out: ReturnParams = {};
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const key = pair.slice(0, eq);
    if (key !== 'code' && key !== 'state' && key !== 'error') continue;
    const value = safeDecode(pair.slice(eq + 1));
    if (value) out[key] = value;
  }
  return out;
}

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return '';
  }
}

/** True when the returned state is exactly the one the app sent. */
export function isExpectedState(expected: string, returned: string | undefined): boolean {
  if (!returned || returned.length !== expected.length) return false;
  // Compare every character so the check does not stop at the first mismatch.
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ returned.charCodeAt(i);
  }
  return diff === 0;
}
