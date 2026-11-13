/**
 * Sign in with Google from the app.
 *
 * The browser session opens Google with an app-marked `state`. Google returns
 * to the website, which sees the mark and hands `code` and `state` back to
 * `aiaas://auth`. The session resolves with that URL. The app checks the state
 * is the one it sent, then exchanges the code the same way the website does
 * (POST /auth/google/ with the website's callback as redirect_uri).
 */
import * as WebBrowser from 'expo-web-browser';

import { me, type AuthUser } from '../api/auth';
import { ApiError, api } from '../api/client';
import { setTokens } from '../api/tokens';
import { isExpectedState, newAppState, readReturnParams } from './appState';
import { GOOGLE_LOGIN_REDIRECT_URI, googleLoginAuthorizeUrl } from './googleConfig';

interface GoogleLoginResponse {
  access: string;
  refresh: string;
}

/**
 * Signs in with Google. Resolves to the user, or to null when the person closed
 * the browser before finishing. Throws with a sentence the screen can show.
 */
export async function signInWithGoogle(): Promise<AuthUser | null> {
  const state = newAppState();
  const result = await WebBrowser.openAuthSessionAsync(googleLoginAuthorizeUrl(state), 'aiaas://auth');
  if (result.type !== 'success') return null;

  const params = readReturnParams(result.url);
  if (!isExpectedState(state, params.state)) {
    throw new Error('That Google sign-in did not start in this app. Please try again.');
  }
  if (params.error) {
    throw new Error(
      params.error === 'access_denied'
        ? 'You declined the Google permission request.'
        : 'Google sign-in failed. Please try again.',
    );
  }
  if (!params.code) throw new Error('Google did not return a sign-in code. Please try again.');

  try {
    const data = await api<GoogleLoginResponse>('/auth/google/', {
      method: 'POST',
      body: { code: params.code, redirect_uri: GOOGLE_LOGIN_REDIRECT_URI },
      auth: false,
    });
    await setTokens(data.access, data.refresh);
  } catch (error) {
    throw googleError(error);
  }
  return me();
}

function googleError(error: unknown): Error {
  // The backend's own sentence (e.g. an unverified Google email) is the useful one.
  if (error instanceof ApiError && error.status === 400) return new Error(error.message);
  if (error instanceof ApiError && error.status === 429) {
    return new Error('Too many sign-in attempts. Wait a moment and try again.');
  }
  if (error instanceof ApiError) return new Error('Google sign-in failed. Please try again.');
  return new Error('Unable to reach the server. Check your connection and try again.');
}
