/**
 * Handing an OAuth return back to the native app.
 *
 * The native app (mobile-native) signs in with Google and connects accounts by
 * opening the provider's page in a browser session. Providers only redirect to
 * the website, so the website must hand the result back to the app. It does
 * that with the app's custom scheme, but only when the flow was started by the
 * app. The app marks its own requests by putting a prefix on the OAuth `state`:
 *
 *   app.<random>      e.g. app.4f9c1e2a8b7d6e5f4a3b2c1d0e9f8a7b
 *
 * A marked state is the only thing that switches a return to the app. A plain
 * web state never does, so a web user is never sent to a scheme they did not
 * ask for. The app checks that the state it gets back is the one it sent.
 *
 * Only `code`, `state` and `error` are forwarded. Nothing else in the callback
 * URL is copied, so a page cannot smuggle parameters into the app's handler.
 */

export const APP_SCHEME = 'aiaas';

/** The prefix a native-app-started OAuth state carries. */
export const APP_STATE_PREFIX = 'app.';

// The prefix, then 16 to 128 URL-safe characters: enough entropy for a state.
const APP_STATE_PATTERN = /^app\.[A-Za-z0-9_-]{16,128}$/;

/** Which app route the return goes to: sign-in (`auth`) or connecting an account (`oauth`). */
export type AppReturnKind = 'auth' | 'oauth';

export interface AppReturnParams {
  code?: string | null;
  state?: string | null;
  error?: string | null;
}

/** True when `state` was started by the native app. */
export function isAppState(state: string | null | undefined): boolean {
  return typeof state === 'string' && APP_STATE_PATTERN.test(state);
}

/**
 * The custom-scheme URL that returns the OAuth result to the app, e.g.
 * `aiaas://auth?code=...&state=app.…`. Returns null when the state is not
 * app-marked, or when there is neither a code nor an error to hand back.
 */
export function appReturnUrl(kind: AppReturnKind, params: AppReturnParams): string | null {
  if (!isAppState(params.state)) return null;
  const pairs: string[] = [];
  if (params.code) pairs.push(`code=${encodeURIComponent(params.code)}`);
  if (params.error) pairs.push(`error=${encodeURIComponent(params.error)}`);
  if (pairs.length === 0) return null;
  pairs.push(`state=${encodeURIComponent(params.state as string)}`);
  return `${APP_SCHEME}://${kind}?${pairs.join('&')}`;
}

/**
 * A connect-account return that no web flow in this browser started (no pending
 * record, no popup opener) came from the app: every web flow leaves a pending
 * record (`lib/oauthFlow.ts`). The backend signs that state, so it carries no
 * app mark; the app checks it against the state its init call issued, and the
 * code can only be exchanged with the app's own signed-in session.
 */
export function orphanConnectReturnUrl(params: AppReturnParams): string | null {
  const state = params.state;
  if (!state || state.length > 2048) return null;
  const pairs: string[] = [];
  if (params.code) pairs.push(`code=${encodeURIComponent(params.code)}`);
  if (params.error) pairs.push(`error=${encodeURIComponent(params.error)}`);
  if (pairs.length === 0) return null;
  pairs.push(`state=${encodeURIComponent(state)}`);
  return `${APP_SCHEME}://oauth?${pairs.join('&')}`;
}
