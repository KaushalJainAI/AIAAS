// Native apps are not subject to browser CORS, so the backend needs no origin
// change. Point a dev build at a local backend with EXPO_PUBLIC_API_ORIGIN.
export const API_ORIGIN: string = (
  process.env.EXPO_PUBLIC_API_ORIGIN || 'https://aiaas.kaushaljain.com'
).replace(/\/+$/, '');

export const API_URL = `${API_ORIGIN}/api`;
