/**
 * Connect an account through a provider's sign-in page, and come back.
 *
 * Three screens did this with three copies of a popup dance (Connections'
 * Google connect, remote MCP servers, the credential modal), and all three
 * depended on a popup reporting to its opener with `postMessage`. That fails in
 * exactly the places a phone puts people:
 *
 *  - Mobile browsers block a popup unless it opens *during* the tap, and every
 *    flow here opens it after an `await` (the authorize URL comes from our API),
 *    so on a phone the popup was usually blocked and the user was told to
 *    "allow pop-ups" in a browser that has no such setting.
 *  - An installed app (home-screen web app, or the mobile wrapper) has no
 *    popups at all.
 *
 * So there are two modes, decided here and nowhere else. **popup** is kept
 * where it works, because it keeps the page the user was on, half-filled forms
 * included. **redirect** sends the whole page to the provider; `/oauth/callback`
 * finishes the exchange and navigates back to where the flow started.
 * A blocked popup falls back to redirect rather than failing.
 *
 * The provider owns the redirect URL, so the callback cannot be told which
 * flow it is finishing through the URL. It is written to `localStorage` before
 * leaving (a popup sees only a *copy* of session storage, and only in some
 * browsers), read exactly once, and ignored when stale.
 */

import { safeNext } from './nextPath';

export type OAuthResult =
  | { status: 'success' }
  | { status: 'error'; message: string }
  | { status: 'dismissed' }
  /** The page is leaving for the provider; the callback page reports the outcome. */
  | { status: 'redirecting' };

/** Which exchange `/oauth/callback` has to run. */
export type OAuthFlowKind = { kind: 'google' } | { kind: 'mcp'; serverId: number };

export type PendingOAuth = OAuthFlowKind & {
  mode: 'popup' | 'redirect';
  /** In-app path to return to in redirect mode. Always passed through `safeNext`. */
  returnTo: string;
  /** What was being connected, for the message shown on return. */
  label: string;
  startedAt: number;
};

export const PENDING_OAUTH_KEY = 'oauth.pending';

/** A sign-in left unfinished for longer than this is not resumed. */
export const PENDING_OAUTH_TTL_MS = 15 * 60 * 1000;

const WIDTH = 600;
const HEIGHT = 700;

/** Encode the pending flow for storage. */
export function encodePending(pending: PendingOAuth): string {
  return JSON.stringify(pending);
}

/**
 * Decode a stored pending flow, or null when it is missing, malformed or
 * stale. Every field is checked: this value decides which endpoint receives
 * the authorization code, and `returnTo` decides where the page goes next.
 */
export function decodePending(raw: string | null, now: number): PendingOAuth | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;

  if (v.mode !== 'popup' && v.mode !== 'redirect') return null;
  if (typeof v.startedAt !== 'number' || now - v.startedAt > PENDING_OAUTH_TTL_MS || v.startedAt > now) {
    return null;
  }
  const label = typeof v.label === 'string' && v.label.trim() ? v.label.slice(0, 80) : 'Account';
  const returnTo = safeNext(typeof v.returnTo === 'string' ? v.returnTo : null);
  const base = { mode: v.mode, label, returnTo, startedAt: v.startedAt } as const;

  if (v.kind === 'google') return { ...base, kind: 'google' };
  if (v.kind === 'mcp' && typeof v.serverId === 'number' && Number.isInteger(v.serverId) && v.serverId > 0) {
    return { ...base, kind: 'mcp', serverId: v.serverId };
  }
  return null;
}

/** Read and clear the pending flow. Cleared even when invalid, so it is never reused. */
export function takePendingOAuth(now = Date.now()): PendingOAuth | null {
  try {
    const raw = window.localStorage.getItem(PENDING_OAUTH_KEY);
    window.localStorage.removeItem(PENDING_OAUTH_KEY);
    return decodePending(raw, now);
  } catch {
    // Blocked site data. The callback then runs the Google credential exchange,
    // the flow that existed first; an MCP connect reports a failure to retry.
    return null;
  }
}

function storePending(pending: PendingOAuth): void {
  try {
    window.localStorage.setItem(PENDING_OAUTH_KEY, encodePending(pending));
  } catch {
    // See takePendingOAuth.
  }
}

/**
 * Whether this page cannot use popups at all: an installed web app or the
 * mobile wrapper. A plain mobile browser is not on this list: it gets a popup
 * try first and the redirect if that is blocked.
 */
export function prefersRedirect(): boolean {
  try {
    if ('Capacitor' in window) return true;
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    return (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function redirectTo(url: string, flow: OAuthFlowKind, label: string): OAuthResult {
  storePending({ ...flow, mode: 'redirect', label, returnTo: currentPath(), startedAt: Date.now() });
  window.location.assign(url);
  return { status: 'redirecting' };
}

/**
 * Send the user to `url` (a provider's authorize page) and resolve with the
 * outcome. In redirect mode it resolves with `redirecting` and the page leaves.
 */
export function startOAuth(url: string, flow: OAuthFlowKind, label: string): Promise<OAuthResult> {
  if (prefersRedirect()) return Promise.resolve(redirectTo(url, flow, label));

  storePending({ ...flow, mode: 'popup', label, returnTo: currentPath(), startedAt: Date.now() });
  const popup = window.open(
    url,
    'oauth-connect',
    `width=${WIDTH},height=${HEIGHT},` +
      `top=${window.screen.height / 2 - HEIGHT / 2},` +
      `left=${window.screen.width / 2 - WIDTH / 2}`,
  );

  // Blocked: carry on in this page instead of asking for a setting phones lack.
  if (!popup) return Promise.resolve(redirectTo(url, flow, label));

  return new Promise<OAuthResult>((resolve) => {
    let settled = false;

    const settle = (result: OAuthResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.clearInterval(closedTimer);
      resolve(result);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'OAUTH_SUCCESS') {
        settle({ status: 'success' });
      } else if (event.data?.type === 'OAUTH_ERROR') {
        settle({ status: 'error', message: event.data.message || 'Sign-in did not complete.' });
      }
    };

    // The popup posts its result and closes itself, so this is the fallback for
    // a user who closed it first — otherwise the caller waits for ever.
    const closedTimer = window.setInterval(() => {
      if (popup.closed) settle({ status: 'dismissed' });
    }, 500);

    window.addEventListener('message', onMessage);
  });
}
