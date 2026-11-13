import * as SecureStore from 'expo-secure-store';

const ACCESS_KEY = 'aiaas.access_token';
const REFRESH_KEY = 'aiaas.refresh_token';

// Mirror of what is in SecureStore, so requests can read the token synchronously.
let access: string | null = null;
let refresh: string | null = null;

/** Call once at startup, before the first request. */
export async function loadTokens(): Promise<void> {
  const [a, r] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
  ]);
  access = a;
  refresh = r;
}

export function getAccessToken(): string | null {
  return access;
}

export function getRefreshToken(): string | null {
  return refresh;
}

export async function setTokens(newAccess: string, newRefresh: string): Promise<void> {
  access = newAccess;
  refresh = newRefresh;
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, newAccess),
    SecureStore.setItemAsync(REFRESH_KEY, newRefresh),
  ]);
}

export async function clearTokens(): Promise<void> {
  access = null;
  refresh = null;
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
  ]);
}
