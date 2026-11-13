import { API_URL } from '../config';
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './tokens';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  /** The parsed error body, so a form can find the field the server refused. */
  readonly body?: unknown;

  constructor(message: string, status: number, code?: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  /** False for sign-in and refresh: no bearer token, and no refresh-and-retry on 401. */
  auth?: boolean;
}

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

let onUnauthorized: (() => void) | null = null;

/** Called once the session is over: the refresh was refused, or there is none. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/** Forget the tokens and tell the UI the user is signed out. */
export async function endSession(): Promise<void> {
  await clearTokens();
  onUnauthorized?.();
}

function buildUrl(path: string, query?: Query): string {
  const pairs = Object.entries(query ?? {})
    .filter((entry): entry is [string, string | number | boolean] => entry[1] != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return `${API_URL}${path}${pairs.length ? `?${pairs.join('&')}` : ''}`;
}

function send(path: string, opts: ApiOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(buildUrl(path, opts.query), {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The most useful sentence in a DRF-style error body, or a plain fallback. */
function messageFrom(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const key of ['detail', 'error', 'message']) {
      const v = d[key];
      if (typeof v === 'string' && v.trim()) return v;
    }
    // Field errors, e.g. { email: ["Enter a valid email."] }.
    for (const v of Object.values(d)) {
      if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
    }
  }
  return `Request failed (${status})`;
}

async function errorFrom(res: Response): Promise<ApiError> {
  const data = parseBody(await res.text());
  const code = (data as { code?: unknown } | null)?.code;
  return new ApiError(messageFrom(data, res.status), res.status, typeof code === 'string' ? code : undefined, data);
}

let refreshing: Promise<string | null> | null = null;

/**
 * Trades the refresh token for a new access token. Resolves to null when the
 * server refuses it (the session is over). Rejects on a network or 5xx failure,
 * which must not sign anyone out. Concurrent callers share one request.
 */
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = doRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function doRefresh(): Promise<string | null> {
  const current = getRefreshToken();
  if (!current) return null;

  // Backend route: core/urls.py `auth/token/refresh/` (simplejwt, rotating).
  const res = await fetch(`${API_URL}/auth/token/refresh/`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ refresh: current }),
  });
  if (!res.ok) {
    if (res.status === 429 || res.status >= 500) throw await errorFrom(res);
    return null;
  }

  const data = (await res.json()) as { access: string; refresh?: string };
  // Rotation blacklists the old refresh token, so the new one must be kept.
  await setTokens(data.access, data.refresh ?? current);
  return data.access;
}

/** One JSON request to the API. A 401 refreshes the session once and retries. */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const auth = opts.auth !== false;
  let res = await send(path, opts, auth ? getAccessToken() : null);

  if (res.status === 401 && auth) {
    let fresh: string | null;
    try {
      fresh = await refreshAccessToken();
    } catch {
      // Offline or the refresh server is down: keep the session, report the 401.
      throw await errorFrom(res);
    }
    if (!fresh) {
      await endSession();
      throw await errorFrom(res);
    }
    res = await send(path, opts, fresh);
  }

  if (!res.ok) throw await errorFrom(res);
  return parseBody(await res.text()) as T;
}
