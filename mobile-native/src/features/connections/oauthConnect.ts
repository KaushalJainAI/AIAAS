/**
 * Connect an account through the provider's own sign-in page.
 *
 * Remote MCP servers (`supports_oauth`) go through `completeConnectOAuth` in
 * src/auth/oauthReturn.ts, which owns the browser session, the state check and
 * the code exchange. Google-backed cards keep the browser step here, since
 * their credential callback is not the MCP exchange. Either way the connection
 * is checked again afterwards, so the answer is what the assistant can use.
 */

import * as WebBrowser from 'expo-web-browser';

import { completeConnectOAuth } from '../../auth/oauthReturn';
import { API_ORIGIN } from '../../config';
import { getMcpServer, validateMcpCredentials } from './api';
import { googleAuthorizationUrl } from './oauth';

/** Where the Google credential flow sends the user back. The website's callback. */
export const OAUTH_RETURN_URL = `${API_ORIGIN}/oauth/callback`;

export type BrowserOutcome = 'returned' | 'cancelled';

export interface OAuthOutcome {
  browser: BrowserOutcome;
  /** Read after the browser closed: whether the connection's credentials work now. */
  connected: boolean;
}

/**
 * Sign a connection in, then read its credentials again. Throws with a sentence
 * the screen can show when the flow itself fails.
 */
export async function connectOAuth(serverId: number): Promise<OAuthOutcome> {
  const server = await getMcpServer(serverId);
  if (server.supports_oauth) {
    const outcome = await completeConnectOAuth(serverId);
    const check = await validateMcpCredentials(serverId);
    return { browser: outcome === 'connected' ? 'returned' : 'cancelled', connected: check.ok };
  }
  const url = await googleAuthorizationUrl(server.icon_slug, OAUTH_RETURN_URL);
  const browser = await openGoogleSignIn(url);
  const check = await validateMcpCredentials(serverId);
  return { browser, connected: check.ok };
}

/** Sign a Google account in for a credential (no connection row yet). The caller re-reads the credentials. */
export async function connectGoogleAccount(): Promise<BrowserOutcome> {
  const url = await googleAuthorizationUrl(undefined, OAUTH_RETURN_URL);
  return openGoogleSignIn(url);
}

async function openGoogleSignIn(url: string): Promise<BrowserOutcome> {
  const result = await WebBrowser.openAuthSessionAsync(url, OAUTH_RETURN_URL);
  return result.type === 'success' ? 'returned' : 'cancelled';
}
