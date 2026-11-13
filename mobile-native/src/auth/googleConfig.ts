/**
 * Google OAuth settings for the app, as the website builds them
 * (better-n8n-frontend/src/lib/googleAuth.ts and lib/origins.ts).
 *
 * The client id is public (it is sent to Google in the authorize URL), and the
 * website hard-codes it rather than reading a build variable, so it is copied
 * here as it is. The backend accepts only the website's callback as the
 * redirect_uri, so both redirect URIs name the public site, never the app.
 */

export const GOOGLE_CLIENT_ID =
  '860732387709-kurtttd0m4nc40mjfvngqh0cklat7odv.apps.googleusercontent.com';

/**
 * The address people open the website at. Set `EXPO_PUBLIC_SITE_ORIGIN` for a
 * build that uses another site; the default is production.
 */
export const SITE_ORIGIN: string = (
  process.env.EXPO_PUBLIC_SITE_ORIGIN || 'https://aiaas.kaushaljain.com'
).replace(/\/+$/, '');

/** Google sign-in returns here. The website forwards app-started sign-ins back to the app. */
export const GOOGLE_LOGIN_REDIRECT_URI = `${SITE_ORIGIN}/auth/google/callback`;

/** Connecting an account returns here (the same URI the website's OAuthCallback uses). */
export const OAUTH_CONNECT_REDIRECT_URI = `${SITE_ORIGIN}/oauth/callback`;

/** The Google authorize URL for sign-in, carrying the app's own `state`. */
export function googleLoginAuthorizeUrl(state: string): string {
  const params = [
    ['client_id', GOOGLE_CLIENT_ID],
    ['redirect_uri', GOOGLE_LOGIN_REDIRECT_URI],
    ['response_type', 'code'],
    ['scope', 'openid email profile'],
    ['access_type', 'online'],
    ['prompt', 'select_account'],
    ['state', state],
  ] as const;
  const query = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
}
