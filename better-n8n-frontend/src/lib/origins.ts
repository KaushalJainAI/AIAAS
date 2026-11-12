/**
 * Where this app lives, and where its server lives.
 *
 * The web build is served by the same host as the API (nginx proxies `/api`
 * and `/ws`, Vite does in dev), so for it both answers are "this page's own
 * origin" and nothing needs configuring. A build that runs somewhere else —
 * the mobile app, whose page origin is `https://localhost` inside a web view —
 * gets both wrong that way: every share link points at `localhost`, every
 * OAuth redirect names an origin no provider has registered, and every API
 * call goes nowhere. So two optional build settings exist:
 *
 *  - `VITE_PUBLIC_SITE_URL` — the address people open, e.g.
 *    `https://aiaas.kaushaljain.com`. Used for anything that leaves the app:
 *    share links, webhook URLs, OAuth redirect URIs.
 *  - `VITE_API_ORIGIN` — the server to call, e.g. the same address. Used for
 *    REST, the SSE streams and the WebSockets.
 *
 * Both are unset in the web build, deliberately. An image once shipped with a
 * `VITE_*` default of `localhost:8000` because nobody passed the build arg, so
 * here an unset or malformed value means "same origin", never a guess. A
 * value is accepted only as a bare `http(s)://host[:port]` — a path, a query
 * or a trailing slash would be concatenated into every URL built from it.
 */

/** A bare `http(s)` origin from `raw`, or null when it is unset or not one. */
export function parseOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // Anything past the host would be glued into every URL built from this.
    if (url.pathname !== '/' || url.search || url.hash || url.username) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The WebSocket base for an http(s) origin: `https://h` -> `wss://h/ws`. */
export function socketBaseFor(origin: string): string {
  const url = new URL(origin);
  return `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}/ws`;
}

const env = import.meta.env;
const configuredSite = parseOrigin(env.VITE_PUBLIC_SITE_URL);
const configuredApi = parseOrigin(env.VITE_API_ORIGIN);

/**
 * The address people open this app at. Use it for every URL that is meant to
 * work outside this tab — a link to share, a callback a provider redirects to.
 */
export const SITE_ORIGIN: string =
  // Guarded because the API modules import this, and they also load in tests
  // and scripts that have no `window`.
  configuredSite ?? (typeof window === 'undefined' ? '' : window.location.origin);

/**
 * The origin the API is called on: `''` (relative, same origin) unless a
 * build set `VITE_API_ORIGIN`.
 */
export const API_ORIGIN: string = configuredApi ?? '';

/** `path` on the public site, e.g. `siteUrl('/p/abc')`. */
export function siteUrl(path: string): string {
  return `${SITE_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}

/** The OAuth landing page every account-connection flow redirects back to. */
export function oauthCallbackUrl(): string {
  return siteUrl('/oauth/callback');
}
