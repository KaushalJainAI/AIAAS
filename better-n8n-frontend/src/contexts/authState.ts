/**
 * The auth context object and the hook that reads it.
 *
 * Split from `AuthContext.tsx` so that file exports the provider and nothing
 * else. A module exporting both a component and a plain function opts out of
 * fast refresh, so editing the provider would remount the tree — which for
 * this provider means dropping the signed-in user mid-edit. Same reasoning as
 * BrowserOS's `osState.ts` / `OSContext.tsx`.
 */
import { createContext, useContext } from 'react';

import type { User } from '../api/auth';

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  googleLogin: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  clearError: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
