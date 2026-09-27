/**
 * Authentication Service
 *
 * Handles login, register, logout, and user profile.
 */

import apiClient, { tokenManager } from './client';
import { googleRedirectUri } from '../lib/googleAuth';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  name?: string;
}

export interface User {
  id: number;
  email: string;
  name: string;
  display_name?: string;
  avatar?: string;
  bio?: string;
  instance_name?: string;
  timezone?: string;
  language?: string;
  tier: 'free' | 'pro' | 'enterprise';
  credits: number;
  llm_provider?: string;
  llm_model?: string;
  /** Default reasoning effort; `''` means the model's own default. */
  llm_effort?: string;
  default_temperature?: number;
  default_max_tokens?: number;
  theme_preference?: 'light' | 'dark' | 'system';
  accent_color?: string;
  createdAt: string;
}

interface BackendProfileResponse {
  user: {
    id: number;
    email: string;
    first_name?: string;
    last_name?: string;
    username: string;
  };
  display_name?: string;
  avatar?: string;
  bio?: string;
  instance_name?: string;
  timezone?: string;
  language?: string;
  tier: User['tier'];
  credits_remaining: number;
  llm_provider?: string;
  llm_model?: string;
  /** Default reasoning effort; `''` means the model's own default. */
  llm_effort?: string;
  default_temperature?: number;
  default_max_tokens?: number;
  theme_preference?: User['theme_preference'];
  accent_color?: string;
  created_at: string;
}

export interface AuthResponse {
  access: string;
  refresh: string;
  user: User;
}

export interface ProfileUpdatePayload extends Partial<User> {
  user?: {
    first_name?: string;
    last_name?: string;
    email?: string;
  };
}

export interface OTPVerifyResponse {
  detail: string;
  verification_token: string;
}

/**
 * A password or email change signs out every session, this one included, and
 * hands back a new pair for this tab. Without storing it the very next request
 * would 401 and the user would be logged out by their own change.
 */
function keepFreshPair(data: { access?: string; refresh?: string }): void {
  if (data?.access && data?.refresh) tokenManager.setTokens(data.access, data.refresh);
}

function mapProfileResponse(data: BackendProfileResponse): User {
  return {
    id: data.user.id,
    email: data.user.email,
    name: `${data.user.first_name || ''} ${data.user.last_name || ''}`.trim() || data.user.username,
    display_name: data.display_name,
    avatar: data.avatar,
    bio: data.bio,
    instance_name: data.instance_name,
    timezone: data.timezone,
    language: data.language,
    tier: data.tier,
    credits: data.credits_remaining,
    llm_provider: data.llm_provider,
    llm_model: data.llm_model,
    llm_effort: data.llm_effort,
    default_temperature: data.default_temperature,
    default_max_tokens: data.default_max_tokens,
    theme_preference: data.theme_preference,
    accent_color: data.accent_color,
    createdAt: data.created_at,
  };
}

/** Helper to extract a user-facing error message from an Axios error */
function extractApiError(error: unknown): { status: number | null; detail: string } {
  const axiosErr = error as {
    response?: { status?: number; data?: { detail?: string; non_field_errors?: string[] } };
    message?: string;
  };
  const status = axiosErr?.response?.status ?? null;
  const detail =
    axiosErr?.response?.data?.detail ||
    axiosErr?.response?.data?.non_field_errors?.[0] ||
    axiosErr?.message ||
    '';
  return { status, detail };
}

export const authService = {
  /**
   * Login with Google OAuth2 code exchange
   */
  async googleLogin(code: string): Promise<AuthResponse> {
    const redirectUri = googleRedirectUri();
    try {
      const response = await apiClient.post<AuthResponse>('/auth/google/', {
        code,
        redirect_uri: redirectUri,
      });
      const { access, refresh } = response.data;
      tokenManager.setTokens(access, refresh);
      return response.data;
    } catch (error) {
      console.error('Google login error', error);
      throw new Error('Google sign-in failed. Please try again.', { cause: error });
    }
  },

  /**
   * Login with email and password
   */
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    try {
      const response = await apiClient.post<AuthResponse>('/auth/login/', {
        email: credentials.email,
        password: credentials.password,
      });
      const { access, refresh } = response.data;
      tokenManager.setTokens(access, refresh);
      return response.data;
    } catch (error: unknown) {
      const { status, detail } = extractApiError(error);

      // 401 = bad credentials (AuthenticationFailed from our serializer)
      // 400 = validation error (missing fields, etc.)
      if (status === 401 || status === 400) {
        // Use the backend's message if it's user-safe, otherwise fall back to generic
        if (
          detail &&
          !detail.toLowerCase().includes('internal') &&
          !detail.toLowerCase().includes('server error')
        ) {
          throw new Error(detail, { cause: error });
        }
        throw new Error('Invalid email or password. Please try again.', { cause: error });
      }

      if (status === 429) {
        throw new Error('Too many login attempts. Please wait a moment and try again.', { cause: error });
      }

      // Network or unknown error — don't expose internals
      throw new Error('Unable to connect. Please check your internet connection and try again.', { cause: error });
    }
  },

  /**
   * Register a new user
   */
  async register(data: RegisterData): Promise<AuthResponse> {
    try {
      const response = await apiClient.post<AuthResponse>('/auth/register/', {
        username: data.email, // Use email as username
        email: data.email,
        password: data.password,
        password2: data.password, // Confirm password
        first_name: data.name?.split(' ')[0] || '',
        last_name: data.name?.split(' ').slice(1).join(' ') || '',
      });
      const { access, refresh } = response.data;
      tokenManager.setTokens(access, refresh);
      return response.data;
    } catch (error: unknown) {
      const { detail } = extractApiError(error);
      const msg = detail.toLowerCase();

      if (msg.includes('username') && msg.includes('exist')) {
        throw new Error('An account with this email already exists.', { cause: error });
      }
      if (msg.includes('email') && (msg.includes('exist') || msg.includes('already'))) {
        throw new Error('An account with this email already exists.', { cause: error });
      }
      if (msg.includes('password') && msg.includes('common')) {
        throw new Error('This password is too common. Please choose a stronger password.', { cause: error });
      }
      if (msg.includes('password') && msg.includes('short')) {
        throw new Error('Password is too short. Please use at least 8 characters.', { cause: error });
      }
      if (msg.includes('password') && msg.includes('numeric')) {
        throw new Error('Password cannot be entirely numeric.', { cause: error });
      }

      // Rethrow as-is if we have a clean detail from the backend
      if (detail) throw new Error(detail, { cause: error });
      throw new Error('Registration failed. Please try again.', { cause: error });
    }
  },

  /**
   * Logout - clear tokens
   */
  async logout(): Promise<void> {
    tokenManager.clearTokens();
  },

  /**
   * Get current user profile
   */
  async getProfile(): Promise<User> {
    const response = await apiClient.get<BackendProfileResponse>('/auth/profile/');
    return mapProfileResponse(response.data);
  },

  /**
   * Update user profile
   */
  async updateProfile(data: ProfileUpdatePayload): Promise<User> {
    const response = await apiClient.patch<BackendProfileResponse>('/auth/profile/', data);
    return mapProfileResponse(response.data);
  },

  /**
   * Upload avatar
   */
  async uploadAvatar(file: File): Promise<{ avatar_url: string }> {
    const formData = new FormData();
    formData.append('avatar', file);
    const response = await apiClient.post('/auth/profile/avatar/', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  /** Send a code to `newEmail`. The address changes only when it comes back. */
  async requestEmailChange(newEmail: string, password: string): Promise<{ detail: string }> {
    const response = await apiClient.post('/auth/email/change/request/', {
      new_email: newEmail, password,
    });
    return response.data;
  },

  async confirmEmailChange(otpCode: string): Promise<{ detail: string; email: string }> {
    const response = await apiClient.post('/auth/email/change/confirm/', {
      otp_code: otpCode,
    });
    keepFreshPair(response.data);
    return response.data;
  },

  async requestPasswordChangeOTP(oldPassword: string): Promise<{ detail: string }> {
    const response = await apiClient.post('/auth/change-password/request-otp/', {
      old_password: oldPassword,
    });
    return response.data;
  },

  async verifyPasswordChangeOTP(otpCode: string): Promise<OTPVerifyResponse> {
    const response = await apiClient.post('/auth/change-password/verify-otp/', {
      otp_code: otpCode,
    });
    return response.data;
  },

  async changePassword(data: {
    old_password: string;
    verification_token: string;
    new_password: string;
    confirm_password: string;
  }): Promise<{ detail: string }> {
    const response = await apiClient.post('/auth/change-password/', data);
    keepFreshPair(response.data);
    return response.data;
  },

  async requestPasswordReset(email: string): Promise<{ detail: string }> {
    const response = await apiClient.post('/auth/password-reset-request/', { email });
    return response.data;
  },

  async verifyPasswordResetOTP(email: string, otpCode: string): Promise<OTPVerifyResponse> {
    const response = await apiClient.post('/auth/password-reset-verify/', {
      email,
      otp_code: otpCode,
    });
    return response.data;
  },

  async confirmPasswordReset(data: {
    email: string;
    verification_token: string;
    new_password: string;
    confirm_password: string;
  }): Promise<{ detail: string }> {
    const response = await apiClient.post('/auth/password-reset-confirm/', data);
    return response.data;
  },

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return tokenManager.isAuthenticated();
  },

  /**
   * The current API key, masked. The server stores only a hash, so the full
   * key exists once — in the create/rotate response — and never again; what
   * comes back here is its first eight characters.
   */
  async getApiKey(): Promise<{ key: string; created_at: string }> {
    const response = await apiClient.get('/auth/api-keys/');
    type Row = { key_prefix: string; created_at: string };
    const data = response.data as Row[] | { results?: Row[] };
    const rows = Array.isArray(data) ? data : data.results ?? [];
    if (rows.length === 0) return { key: '', created_at: '' };
    return { key: `${rows[0].key_prefix}…`, created_at: rows[0].created_at };
  },

  /**
   * Regenerate API Key.
   *
   * Rotates the user's existing key via the dedicated `rotate/` route. The old
   * code POSTed an empty body to the create endpoint, which always 400'd
   * because `name` is required. If no key exists yet, one is created with a
   * default name.
   */
  async regenerateApiKey(): Promise<{ key: string; created_at: string }> {
    const listResponse = await apiClient.get('/auth/api-keys/');
    const raw = listResponse.data as
      | { id: number; created_at?: string }[]
      | { results?: { id: number; created_at?: string }[] };
    const keys = Array.isArray(raw) ? raw : raw.results ?? [];

    if (keys.length > 0) {
      const { id } = keys[0];
      const response = await apiClient.post(`/auth/api-keys/${id}/rotate/`);
      const data = response.data as { new_key: string };
      return { key: data.new_key, created_at: new Date().toISOString() };
    }

    const created = await apiClient.post('/auth/api-keys/', {
      name: 'Default API Key',
    });
    const data = created.data as { api_key: string; data?: { created_at?: string } };
    return {
      key: data.api_key,
      created_at: data.data?.created_at ?? new Date().toISOString(),
    };
  },
};

export default authService;
