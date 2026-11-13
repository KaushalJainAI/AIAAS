// Same endpoints as better-n8n-frontend/src/api/auth.ts:
//   POST /api/auth/login/          {email, password} -> {access, refresh, user}
//   GET  /api/auth/profile/        -> {user: {id, email, first_name, last_name, username}, tier, credits_remaining, ...}
// Refresh lives in client.ts (POST /api/auth/token/refresh/).
import { ApiError, api } from './client';
import { clearTokens, setTokens } from './tokens';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  tier: 'free' | 'pro' | 'enterprise';
  credits: number;
}

interface LoginResponse {
  access: string;
  refresh: string;
  user: AuthUser;
}

interface ProfileResponse {
  user: { id: number; email: string; first_name?: string; last_name?: string; username: string };
  tier: AuthUser['tier'];
  credits_remaining: number;
}

function loginError(error: unknown): Error {
  if (error instanceof ApiError) {
    if (error.status === 400 || error.status === 401) return new Error(error.message);
    if (error.status === 429) return new Error('Too many sign-in attempts. Wait a moment and try again.');
    return new Error('Sign-in failed. Please try again.');
  }
  return new Error('Unable to reach the server. Check your connection and try again.');
}

export async function login(email: string, password: string): Promise<AuthUser> {
  let data: LoginResponse;
  try {
    data = await api<LoginResponse>('/auth/login/', {
      method: 'POST',
      body: { email, password },
      auth: false,
    });
  } catch (error) {
    throw loginError(error);
  }
  await setTokens(data.access, data.refresh);
  return data.user;
}

export async function logout(): Promise<void> {
  await clearTokens();
}

export async function me(): Promise<AuthUser> {
  const p = await api<ProfileResponse>('/auth/profile/');
  const name = `${p.user.first_name ?? ''} ${p.user.last_name ?? ''}`.trim() || p.user.username;
  return {
    id: p.user.id,
    email: p.user.email,
    name,
    tier: p.tier,
    credits: p.credits_remaining,
  };
}
