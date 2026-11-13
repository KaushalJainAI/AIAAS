/**
 * Connecting an account (an MCP connection) from the app.
 *
 * The provider page opens in a browser session that returns to `aiaas://oauth`.
 * The website's /oauth/callback page hands the code back there when it sees an
 * app-marked state. This function then exchanges the code with the app's own
 * token, which the website's callback cannot do from the browser.
 *
 * Known gap (see the mobile report): the backend mints the state for connect
 * flows and signs it, so the website cannot yet tell an app-started connect
 * from a web one. Until the backend carries an app marker in that state, the
 * return does not reach the app and the session ends as cancelled. The state
 * check below still holds: a return must carry the state the init call issued.
 */
import * as WebBrowser from 'expo-web-browser';

import { mcpOAuthCallback, mcpOAuthInit } from '../features/connections/api';
import { readReturnParams, isExpectedState } from './appState';
import { OAUTH_CONNECT_REDIRECT_URI } from './googleConfig';

export type ConnectResult = 'connected' | 'cancelled';

/**
 * Connects MCP server `serverId`. Resolves to 'connected' on success, or
 * 'cancelled' when the browser session was closed. Throws with a sentence the
 * screen can show.
 */
export async function completeConnectOAuth(serverId: number): Promise<ConnectResult> {
  const { url } = await mcpOAuthInit(serverId, OAUTH_CONNECT_REDIRECT_URI);
  // The state the backend issued for this init call. The return must carry it back.
  const issuedState = readReturnParams(url).state;
  if (!issuedState) throw new Error('The connection could not be started. Please try again.');

  const result = await WebBrowser.openAuthSessionAsync(url, 'aiaas://oauth');
  if (result.type !== 'success') return 'cancelled';

  const params = readReturnParams(result.url);
  if (params.error) {
    throw new Error(
      params.error === 'access_denied'
        ? 'You declined the permission request.'
        : 'The provider reported an error. Please try again.',
    );
  }
  if (!isExpectedState(issuedState, params.state)) {
    throw new Error('That sign-in did not come back for this connection. Please try again.');
  }
  if (!params.code) throw new Error('The provider did not return an authorisation code.');

  await mcpOAuthCallback(serverId, params.code, issuedState);
  return 'connected';
}
