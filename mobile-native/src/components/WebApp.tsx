/**
 * An existing web screen shown inside the app. Used for editors that are not
 * built natively yet, so they keep the web's behaviour instead of a copy of it.
 *
 * Sessions: the WebView is seeded with the app's tokens once per WebView
 * instance, and every token the web app writes back is copied into the app's
 * secure store. The web app rotates its refresh token, so without that copy
 * the app's own refresh token would be blacklisted and the user signed out.
 */
import { useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, StyleSheet, View } from 'react-native';
import WebView, { type WebViewMessageEvent, type WebViewNavigation, type WebViewProps } from 'react-native-webview';

import { API_ORIGIN } from '../config';
import { getAccessToken, getRefreshToken, setTokens } from '../api/tokens';
import { useTheme } from '../theme';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';

interface Props {
  /** An in-app path such as `/documents`. Validated by the caller (app/web.tsx). */
  path: string;
  title?: string;
}

const TOKEN_KEYS = ['access_token', 'refresh_token'] as const;
type TokenKey = (typeof TOKEN_KEYS)[number];

function isTokenKey(value: unknown): value is TokenKey {
  return typeof value === 'string' && (TOKEN_KEYS as readonly string[]).includes(value);
}

/** Runs before the page's own scripts on every load: reports token writes to the app. */
const REPORT_TOKEN_WRITES = `(function () {
  try {
    var bridge = window.ReactNativeWebView;
    if (!bridge || window.__aiaasTokenReport) return;
    window.__aiaasTokenReport = true;
    var setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      setItem.call(this, key, value);
      if (this === window.localStorage && (key === 'access_token' || key === 'refresh_token')) {
        bridge.postMessage(JSON.stringify({ type: 'tokens', key: key, value: String(value) }));
      }
    };
  } catch (e) {}
})(); true;`;

/** The app's current tokens, written once per WebView instance (not on every navigation). */
function seedScript(access: string | null, refresh: string | null): string {
  const write = (key: TokenKey, value: string | null) =>
    value ? `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});` : `localStorage.removeItem(${JSON.stringify(key)});`;
  return `(function () {
  try {
    if (sessionStorage.getItem('aiaas_seeded')) return;
    sessionStorage.setItem('aiaas_seeded', '1');
    ${write('access_token', access)}
    ${write('refresh_token', refresh)}
  } catch (e) {}
})(); true;`;
}

interface Session {
  /** Changes on retry, so the WebView remounts with a fresh seed. */
  key: number;
  seed: string;
}

function newSession(key: number): Session {
  return { key, seed: `${REPORT_TOKEN_WRITES}\n${seedScript(getAccessToken(), getRefreshToken())}` };
}

/** True for the API origin itself and paths under it. Compares strings: the native URL class is partial here. */
function isInsideOrigin(url: string): boolean {
  const origin = API_ORIGIN;
  return url === origin || url.startsWith(`${origin}/`) || url.startsWith(`${origin}?`) || url.startsWith(`${origin}#`);
}

function handleTokenReport(data: string): void {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return;
  }
  if (!message || typeof message !== 'object') return;
  const { type, key, value } = message as { type?: unknown; key?: unknown; value?: unknown };
  if (type !== 'tokens' || !isTokenKey(key) || typeof value !== 'string' || value === '') return;

  const access = key === 'access_token' ? value : getAccessToken();
  const refresh = key === 'refresh_token' ? value : getRefreshToken();
  if (!access || !refresh) return;
  setTokens(access, refresh).catch(() => {
    // Secure storage refused the write: the next app refresh will carry on.
  });
}

export function WebApp({ path, title }: Props) {
  const { colors } = useTheme();
  const webRef = useRef<WebView<WebViewProps>>(null);
  const canGoBack = useRef(false);
  const [session, setSession] = useState<Session>(() => newSession(0));
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);

  // Android hardware back steps back through the web app's own history first.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack.current) return false;
      webRef.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, []);

  function retry() {
    setFailure(null);
    setLoading(true);
    setSession((current) => newSession(current.key + 1));
  }

  // Only our own pages may load in the view. Other web links open in the browser.
  function allowRequest(request: WebViewNavigation): boolean {
    if (isInsideOrigin(request.url)) return true;
    if (/^https?:\/\//i.test(request.url)) {
      Linking.openURL(request.url).catch(() => {
        // No handler for the link: nothing useful to show.
      });
    }
    return false;
  }

  if (failure) {
    return <ErrorState message={failure} onRetry={retry} />;
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <WebView<WebViewProps>
        key={session.key}
        ref={webRef}
        accessibilityLabel={title ?? 'Web page'}
        source={{ uri: `${API_ORIGIN}${path}` }}
        style={{ flex: 1, backgroundColor: colors.background }}
        injectedJavaScriptBeforeContentLoaded={session.seed}
        onShouldStartLoadWithRequest={allowRequest}
        setSupportMultipleWindows={false}
        allowsBackForwardNavigationGestures
        domStorageEnabled
        onMessage={(event: WebViewMessageEvent) => handleTokenReport(event.nativeEvent.data)}
        onNavigationStateChange={(state) => {
          canGoBack.current = state.canGoBack;
        }}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={(event) => {
          setLoading(false);
          setFailure(event.nativeEvent.description || 'Could not reach the server. Check your connection.');
        }}
        onHttpError={(event) => {
          if (event.nativeEvent.statusCode >= 500) {
            setLoading(false);
            setFailure('The server could not open this page. Try again in a moment.');
          }
        }}
      />
      {loading ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}>
          <LoadingState text={title ? `Opening ${title}` : 'Loading'} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
