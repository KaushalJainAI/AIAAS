/**
 * Google OAuth is only usable on an origin registered with Google.
 *
 * The redirect_uri is always `<origin>/auth/google/callback` — there is nothing
 * per-environment about its *shape*, only about which origins Google will
 * accept. So the origin list is the thing worth storing, and the URI is derived
 * from wherever the bundle happens to be served. Served from an unregistered
 * origin — a preview build, a LAN IP, testing.kaushaljain.com — Google rejects
 * the redirect_uri and the user gets a Google error page with no way back.
 * Offering a button that cannot work is worse than not offering one, so the
 * sign-in pages hide it unless the current origin is on the list.
 *
 * This used to be VITE_GOOGLE_REDIRECT_URI baked in at build time, which made a
 * correct build depend on an untracked .env file — and the check silently
 * disabled Google sign-in on `npm run dev` (:5173) because the URI named :3000.
 * Add an origin here and to the Google Cloud console together; they are two
 * halves of one fact.
 */
const GOOGLE_OAUTH_ORIGINS = [
  'https://aiaas.kaushaljain.com',
  'http://localhost:3000',
];

/**
 * Public OAuth client identifier. Not a secret — it is transmitted to Google in
 * the authorize URL and ships in the bundle regardless of where it is read from.
 */
export const GOOGLE_CLIENT_ID =
  '860732387709-kurtttd0m4nc40mjfvngqh0cklat7odv.apps.googleusercontent.com';

/** The redirect_uri for the current origin. Must match `/auth/google/callback` in App.tsx. */
export function googleRedirectUri(): string {
  return `${window.location.origin}/auth/google/callback`;
}

export function googleAuthAvailable(): boolean {
  return GOOGLE_OAUTH_ORIGINS.includes(window.location.origin);
}

/** The full Google authorize URL to send the browser to. */
export function googleAuthorizeUrl(): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
