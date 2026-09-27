/**
 * Landing page for the credential OAuth popup.
 *
 * `/oauth/callback` was already being sent to Google as the redirect_uri (from
 * CredentialModal, and now from Connections), but no route rendered it: the popup
 * landed on an unmatched path, the code was never exchanged, and no credential
 * was ever created. "Connect with Google" appeared to do nothing.
 *
 * This is deliberately not the same page as GoogleCallback, which handles
 * *logging in* with Google. Here the user is already authenticated and is
 * authorising access to their data — a different exchange against a different
 * endpoint, producing a Credential rather than a session.
 */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { credentialsService } from '../api/credentials';
import { mcpService } from '../api/mcp';

type Phase = 'working' | 'done' | 'failed';

/**
 * Which flow this popup is finishing.
 *
 * The provider owns the redirect URL, so the opener cannot add a marker to it —
 * it records one here before opening the popup instead. `localStorage` rather
 * than `sessionStorage`: a popup inherits only a *copy* of session storage, and
 * only in some browsers, so a value written by the opener after `window.open`
 * would not be visible here.
 *
 * Consumed exactly once, and cleared even when the exchange fails: a stale key
 * would send the next Google connection to the MCP endpoint.
 */
const MCP_FLOW_KEY = 'oauth.mcp_server_id';

function takePendingMcpServerId(): number | null {
  try {
    const raw = window.localStorage.getItem(MCP_FLOW_KEY);
    window.localStorage.removeItem(MCP_FLOW_KEY);
    const id = Number(raw);
    return raw && Number.isFinite(id) ? id : null;
  } catch {
    // Storage can be unavailable (private mode, blocked site data). Falling
    // back to the credential flow is the safer default: it is the one that
    // existed before, and an MCP connect simply reports a failure the user
    // can retry.
    return null;
  }
}

export default function OAuthCallback() {
  const [searchParams] = useSearchParams();
  const [phase, setPhase] = useState<Phase>('working');
  const [message, setMessage] = useState('');
  // Popups can re-render before they close; exchanging a code twice fails the
  // second time and would report an error over a success.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const code = searchParams.get('code');
    const state = searchParams.get('state') ?? undefined;
    const oauthError = searchParams.get('error');
    // Consumed before any early return: a key left behind by a declined or
    // malformed authorization would send the *next* Google connection to the
    // MCP endpoint.
    const mcpServerId = takePendingMcpServerId();

    /**
     * The opener owns the UI; this window only reports back. Targeting our own
     * origin keeps the message off any other page that might be listening.
     */
    const report = (payload: { type: string; message?: string }) => {
      try {
        window.opener?.postMessage(payload, window.location.origin);
      } catch {
        // A closed or cross-origin opener is not recoverable and not fatal:
        // the fallback text below tells the user they can close this window.
      }
    };

    const fail = (text: string) => {
      setPhase('failed');
      setMessage(text);
      report({ type: 'OAUTH_ERROR', message: text });
    };

    if (oauthError) {
      fail(
        oauthError === 'access_denied'
          ? 'You declined the permission request.'
          : `The provider reported an error: ${oauthError}`
      );
      return;
    }

    if (!code) {
      fail('The provider did not return an authorisation code.');
      return;
    }

    void (async () => {
      try {
        if (mcpServerId !== null) {
          // An MCP server authorization. `state` is required here — it is what
          // the backend looks the PKCE verifier up by.
          if (!state) {
            fail('The provider did not return the expected sign-in state.');
            return;
          }
          await mcpService.oauthCallback(mcpServerId, code, state);
        } else {
          await credentialsService.completeGoogleOAuth({
            code,
            redirect_uri: `${window.location.origin}/oauth/callback`,
            state,
            name: 'Google Account',
          });
        }
        setPhase('done');
        report({ type: 'OAUTH_SUCCESS' });
        // Leave the confirmation up briefly so a popup that fails to close is
        // not mistaken for a hang.
        window.setTimeout(() => window.close(), 800);
      } catch (err: unknown) {
        const detail = (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error;
        fail(detail ?? 'Could not finish connecting your account.');
      }
    })();
  }, [searchParams]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background px-6 text-center">
      {phase === 'working' && (
        <>
          <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Connecting your account…</p>
        </>
      )}
      {phase === 'done' && (
        <>
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-4" />
          <p className="font-semibold text-foreground">Account connected</p>
          <p className="text-sm text-muted-foreground mt-1">
            You can close this window.
          </p>
        </>
      )}
      {phase === 'failed' && (
        <>
          <AlertCircle className="w-10 h-10 text-destructive mb-4" />
          <p className="font-semibold text-foreground">Could not connect</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">{message}</p>
          <button
            onClick={() => window.close()}
            className="mt-6 px-5 py-2 rounded-lg border border-border/60 text-sm font-semibold hover:bg-muted transition-colors"
          >
            Close
          </button>
        </>
      )}
    </div>
  );
}
