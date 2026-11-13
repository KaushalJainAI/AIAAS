import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { login, logout, me, type AuthUser } from '../api/auth';
import { setUnauthorizedHandler } from '../api/client';
import { getAccessToken, getRefreshToken, loadTokens } from '../api/tokens';
import { unregisterDevice } from '../notifications/push';
import { signInWithGoogle as signInWithGoogleCode } from './googleSignIn';
import { signUpWithEmail, type SignUpInput } from './signUp';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthValue {
  user: AuthUser | null;
  status: AuthStatus;
  signIn: (email: string, password: string) => Promise<void>;
  /** Resolves false when the person closed the Google sign-in before finishing. */
  signInWithGoogle: () => Promise<boolean>;
  signUp: (input: SignUpInput) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-read the profile, e.g. after the name was edited. */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  const markSignedOut = useCallback(() => {
    setUser(null);
    setStatus('signedOut');
    // The next account must not see the previous account's cached data.
    queryClient.clear();
  }, [queryClient]);

  // The api client calls this when a session is refused.
  useEffect(() => {
    setUnauthorizedHandler(markSignedOut);
    return () => setUnauthorizedHandler(null);
  }, [markSignedOut]);

  // Restore the session on launch. A network failure keeps the stored tokens.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await loadTokens();
        if (!getAccessToken() && !getRefreshToken()) {
          if (alive) markSignedOut();
          return;
        }
        const current = await me();
        if (alive) {
          setUser(current);
          setStatus('signedIn');
        }
      } catch {
        if (alive) markSignedOut();
      }
    })();
    return () => {
      alive = false;
    };
  }, [markSignedOut]);

  const signIn = useCallback(async (email: string, password: string) => {
    const signedIn = await login(email, password);
    setUser(signedIn);
    setStatus('signedIn');
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const signedIn = await signInWithGoogleCode();
    if (!signedIn) return false;
    setUser(signedIn);
    setStatus('signedIn');
    return true;
  }, []);

  const signUp = useCallback(async (input: SignUpInput) => {
    const created = await signUpWithEmail(input);
    setUser(created);
    setStatus('signedIn');
  }, []);

  const signOut = useCallback(async () => {
    // Forget this phone on the server while the session can still authorise it.
    await unregisterDevice().catch(() => undefined);
    await logout();
    markSignedOut();
  }, [markSignedOut]);

  const refreshUser = useCallback(async () => {
    setUser(await me());
  }, []);

  const value = useMemo(
    () => ({ user, status, signIn, signInWithGoogle, signUp, signOut, refreshUser }),
    [user, status, signIn, signInWithGoogle, signUp, signOut, refreshUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
