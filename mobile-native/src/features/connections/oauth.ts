/**
 * The provider authorization URL for each kind of connection, as the web asks
 * for it. The screen opens the URL (in a browser session that returns to
 * `redirectUri`); nothing here opens anything.
 *
 * Mirrors the callers of `startOAuth` in better-n8n-frontend/src/pages/Connections.tsx:
 *  - Google (credential-backed connectors):  initGoogleOAuth with the scopes for
 *                                            the connector's icon_slug
 *  - Remote MCP servers:                     mcpService.oauthInit
 *
 * `redirectUri` must be one the backend accepts (`credentials/oauth.py::ALLOWED_REDIRECT_ORIGINS`).
 * The web uses `oauthCallbackUrl()`, which is an app URL; a native app needs its
 * own registered callback, which the screen supplies.
 */

import { initGoogleOAuth } from '../credentials/api';
import { mcpOAuthInit } from './api';
import { googleScopesFor } from './googleScopes';

/** The URL to send the user to for an MCP server's OAuth sign-in. */
export async function mcpAuthorizationUrl(serverId: number, redirectUri: string): Promise<string> {
  const { url } = await mcpOAuthInit(serverId, redirectUri);
  return url;
}

/** The URL to send the user to for a Google-backed connector, with that connector's scopes. */
export async function googleAuthorizationUrl(
  iconSlug: string | undefined,
  redirectUri: string,
): Promise<string> {
  const { url } = await initGoogleOAuth(redirectUri, googleScopesFor(iconSlug));
  return url;
}
