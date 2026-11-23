import { API_ORIGIN } from '@/lib/origins';

/** Served by this app or its own API, so loading it tells no third party anything. */
export function isOwnOrigin(src: string): boolean {
  if (src.startsWith('/') && !src.startsWith('//')) return true;
  try {
    const origin = new URL(src, window.location.href).origin;
    return origin === window.location.origin || (API_ORIGIN !== '' && origin === API_ORIGIN);
  } catch {
    return false;
  }
}
