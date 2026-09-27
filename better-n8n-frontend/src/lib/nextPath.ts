/**
 * Where to go after signing in, when the visitor was heading somewhere.
 *
 * A public agent link lands on `/a/:slug`, which anyone can read; installing
 * needs an account, so the CTA sends them to sign in *with* the page they
 * wanted. Without this the auth screens always land on `/`, and a link shared
 * outside the platform loses its visitor at exactly the step it was meant to
 * survive.
 *
 * The whole file is really one rule: **only same-origin paths**. `?next=` is
 * attacker-controllable — it travels in a URL anyone can compose and send —
 * so a value that is not a plain in-app path is discarded rather than
 * sanitised. Three shapes are refused and each is a real open redirect:
 *
 *   `https://evil.example`  an absolute URL to somewhere else
 *   `//evil.example`        protocol-relative, which browsers resolve as above
 *   `javascript:…`          a scheme, not a path, and a script if it is ever
 *                           put in an href
 *
 * Refusing rather than repairing is deliberate: a "fixed" hostile value is
 * still a value someone chose, and the cost of discarding it is that the
 * visitor lands on the home page, which is where they would have landed
 * anyway.
 */

/**
 * The default landing page, and what every refusal falls back to.
 *
 * First login opens a fresh Ask chat (`/ai-chat` with no session), not the
 * landing wrapper at `/` — one less redirect and the composer is the first
 * thing a new user sees.
 */
export const DEFAULT_LANDING = '/ai-chat';

/**
 * The safe redirect target from a `?next=` parameter, or `DEFAULT_LANDING`.
 *
 * Accepts only a path beginning with a single `/`. Backslashes are rejected
 * too: some browsers normalise `/\evil.example` to a protocol-relative URL, so
 * it is the same attack wearing a different character.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next) return DEFAULT_LANDING;
  if (!next.startsWith('/')) return DEFAULT_LANDING;
  if (next.startsWith('//') || next.startsWith('/\\')) return DEFAULT_LANDING;
  return next;
}

/** Read `?next=` from a query string and resolve it. */
export function nextFrom(search: string): string {
  return safeNext(new URLSearchParams(search).get('next'));
}

/** Append `?next=` to an auth route, for a link that must survive signing in. */
export function withNext(authPath: string, target: string): string {
  return `${authPath}?next=${encodeURIComponent(target)}`;
}
