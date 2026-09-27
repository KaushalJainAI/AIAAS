/**
 * Auth Context
 * 
 * Global authentication state and methods.
 */

import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authService } from '../api/auth';
import { tokenManager, setUnauthorizedCallback } from '../api/client';
import { abortAllChatRuns } from '../lib/chatRuns';

import { AuthContext } from './authState';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: user = null, isLoading, refetch } = useQuery({
    queryKey: ['authProfile'],
    queryFn: async () => {
      if (!tokenManager.isAuthenticated()) {
        return null;
      }
      try {
        const userData = await authService.getProfile();
        return userData;
      } catch (err) {
        console.error('Operation failed', err);
        tokenManager.clearTokens();
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  const isAuthenticated = !!user;

  useEffect(() => {
    // Set up 401 handling
    setUnauthorizedCallback(() => {
      // A chat stream outlives the page that started it (`lib/chatRuns.ts`),
      // so signing out has to stop it here or it keeps writing into the next
      // user's session.
      abortAllChatRuns();
      queryClient.setQueryData(['authProfile'], null);
      tokenManager.clearTokens();
    });
  }, [queryClient]);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const response = await authService.login({ email, password });
      queryClient.setQueryData(['authProfile'], response.user);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      throw err;
    }
  }, [queryClient]);

  const register = useCallback(async (email: string, password: string, name?: string) => {
    setError(null);
    try {
      const response = await authService.register({ email, password, name });
      queryClient.setQueryData(['authProfile'], response.user);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      setError(message);
      throw err;
    }
  }, [queryClient]);

  const googleLogin = useCallback(async (code: string) => {
    setError(null);
    try {
      const response = await authService.googleLogin(code);
      queryClient.setQueryData(['authProfile'], response.user);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google login failed';
      setError(message);
      throw err;
    }
  }, [queryClient]);

  const logout = useCallback(async () => {
    abortAllChatRuns();
    try {
      await authService.logout();
    } finally {
      queryClient.setQueryData(['authProfile'], null);
    }
  }, [queryClient]);

  const refreshUser = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Memoised: this provider sits above every route, so an unstable value made
  // each of its renders a re-render of every screen that reads auth.
  const value = useMemo(
    () => ({
      user,
      isAuthenticated,
      isLoading,
      error,
      login,
      register,
      googleLogin,
      logout,
      refreshUser,
      clearError,
    }),
    [user, isAuthenticated, isLoading, error, login, register, googleLogin,
     logout, refreshUser, clearError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

