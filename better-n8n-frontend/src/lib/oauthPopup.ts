/**
 * Run an OAuth authorization in a popup and resolve when it finishes.
 *
 * Extracted from Connections' Google flow when MCP server authorization needed
 * the same thing. The three details worth keeping in one place are all ways the
 * naive version leaves the caller stuck on a spinner:
 *
 *  - the popup reports back by `postMessage`, and a message from another origin
 *    must be ignored;
 *  - the user can simply close the window, which sends no message at all, so a
 *    poll on `popup.closed` is what stops the caller hanging;
 *  - a blocked popup returns null rather than throwing.
 */

export type OAuthPopupResult =
  | { status: 'success' }
  | { status: 'error'; message: string }
  | { status: 'dismissed' };

const WIDTH = 600;
const HEIGHT = 700;

export function openOAuthPopup(url: string, title = 'Connect account'): Promise<OAuthPopupResult> {
  const popup = window.open(
    url,
    title,
    `width=${WIDTH},height=${HEIGHT},` +
      `top=${window.screen.height / 2 - HEIGHT / 2},` +
      `left=${window.screen.width / 2 - WIDTH / 2}`,
  );

  if (!popup) {
    return Promise.resolve({
      status: 'error',
      message: 'Your browser blocked the sign-in window. Allow pop-ups and try again.',
    });
  }

  return new Promise<OAuthPopupResult>((resolve) => {
    let settled = false;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(closedTimer);
    };

    const settle = (result: OAuthPopupResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'OAUTH_SUCCESS') {
        settle({ status: 'success' });
      } else if (event.data?.type === 'OAUTH_ERROR') {
        settle({
          status: 'error',
          message: event.data.message || 'Sign-in did not complete.',
        });
      }
    };

    // The popup posts its result and then closes itself, so this timer is the
    // fallback for a user who closed it first — not the normal path.
    const closedTimer = window.setInterval(() => {
      if (popup.closed) settle({ status: 'dismissed' });
    }, 500);

    window.addEventListener('message', onMessage);
  });
}

/**
 * Tell `/oauth/callback` that the popup it is about to render belongs to an MCP
 * server authorization rather than the Google credential flow.
 *
 * `localStorage`, not `sessionStorage`: a popup inherits only a copy of session
 * storage, and only in some browsers.
 */
export const MCP_FLOW_KEY = 'oauth.mcp_server_id';

export function markMcpOAuthFlow(serverId: number): void {
  try {
    window.localStorage.setItem(MCP_FLOW_KEY, String(serverId));
  } catch {
    // Blocked site data. The callback falls back to the credential flow and
    // reports a failure the user can retry; nothing is silently mis-exchanged.
  }
}
