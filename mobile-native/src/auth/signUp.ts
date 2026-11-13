/**
 * Create an account from the app. Same endpoint and body as the website's
 * register (better-n8n-frontend/src/api/auth.ts): the email is the username,
 * the name is split into first and last name.
 */
import { me, type AuthUser } from '../api/auth';
import { ApiError, api } from '../api/client';
import { setTokens } from '../api/tokens';

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

interface RegisterResponse {
  access: string;
  refresh: string;
}

export async function signUpWithEmail(input: SignUpInput): Promise<AuthUser> {
  const parts = input.name.trim().split(/\s+/);
  const firstName = parts[0] ?? '';
  const lastName = parts.slice(1).join(' ');
  let data: RegisterResponse;
  try {
    data = await api<RegisterResponse>('/auth/register/', {
      method: 'POST',
      body: {
        username: input.email,
        email: input.email,
        password: input.password,
        password2: input.password,
        first_name: firstName,
        last_name: lastName,
      },
      auth: false,
    });
  } catch (error) {
    throw signUpError(error);
  }
  await setTokens(data.access, data.refresh);
  return me();
}

function signUpError(error: unknown): Error {
  if (error instanceof ApiError) {
    const msg = error.message.toLowerCase();
    if (msg.includes('exist') && (msg.includes('username') || msg.includes('email'))) {
      return new Error('An account with this email already exists.');
    }
    if (msg.includes('common')) {
      return new Error('This password is too common. Please choose a stronger password.');
    }
    if (error.status === 400) return new Error(error.message);
    if (error.status === 429) return new Error('Too many attempts. Wait a moment and try again.');
    return new Error('Could not create your account. Please try again.');
  }
  return new Error('Unable to reach the server. Check your connection and try again.');
}
