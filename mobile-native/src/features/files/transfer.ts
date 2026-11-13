/**
 * Authorised requests that are not JSON: multipart uploads and file bytes.
 *
 * `api()` in `src/api/client.ts` always sends a JSON Content-Type and returns
 * parsed JSON, so it cannot carry a FormData body or hand back a file. This
 * module does the same thing for those two cases, with the same bearer token,
 * the same one-retry-after-refresh on 401, and the same error shape (ApiError).
 *
 * Do NOT set Content-Type on a FormData request: fetch must write the multipart
 * boundary itself.
 */
import { API_URL } from '../../config';
import { ApiError, endSession, refreshAccessToken } from '../../api/client';
import { getAccessToken } from '../../api/tokens';

type Query = Record<string, string | number | boolean | null | undefined>;

export interface TransferOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** A FormData body, or a string. JSON bodies go through `api()` instead. */
  body?: FormData | string;
  query?: Query;
  /** False for public pages: no bearer token, and no refresh-and-retry. */
  auth?: boolean;
}

export function buildUrl(path: string, query?: Query): string {
  const pairs = Object.entries(query ?? {})
    .filter((entry): entry is [string, string | number | boolean] => entry[1] != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return `${API_URL}${path}${pairs.length ? `?${pairs.join('&')}` : ''}`;
}

/** Same rules as `client.ts::messageFrom`: the most useful sentence in a DRF-style body. */
function messageFrom(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const key of ['detail', 'error', 'message']) {
      const v = d[key];
      if (typeof v === 'string' && v.trim()) return v;
    }
    for (const v of Object.values(d)) {
      if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
    }
  }
  return `Request failed (${status})`;
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function errorFrom(res: Response): Promise<ApiError> {
  const data = parseBody(await res.text());
  const code = (data as { code?: unknown } | null)?.code;
  return new ApiError(messageFrom(data, res.status), res.status, typeof code === 'string' ? code : undefined, data);
}

/** The Authorization header for a request made outside `api()`, e.g. an `<Image>` source. */
export function authorizationHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * One authorised request, returning the raw Response on success.
 *
 * A 401 refreshes the session once and retries. A refresh the server refuses
 * ends the session, as in `api()`. A network failure during the refresh keeps
 * the session and reports the original 401.
 */
export async function authorizedFetch(path: string, opts: TransferOptions = {}): Promise<Response> {
  const auth = opts.auth !== false;
  const url = buildUrl(path, opts.query);
  const send = (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(url, { method: opts.method ?? 'GET', headers, body: opts.body });
  };

  let res = await send(auth ? getAccessToken() : null);
  if (res.status === 401 && auth) {
    let fresh: string | null;
    try {
      fresh = await refreshAccessToken();
    } catch {
      throw await errorFrom(res);
    }
    if (!fresh) {
      await endSession();
      throw await errorFrom(res);
    }
    res = await send(fresh);
  }

  if (!res.ok) throw await errorFrom(res);
  return res;
}

/** Bytes of a file (or a preview of one). Callers read `.blob()` or `.arrayBuffer()`. */
export function fetchFile(
  path: string,
  opts: { query?: Query; auth?: boolean } = {},
): Promise<Response> {
  return authorizedFetch(path, { method: 'GET', query: opts.query, auth: opts.auth });
}

/** Parse a successful response as JSON. An empty body is null, as in `api()`. */
export async function readJson<T>(res: Response): Promise<T> {
  return parseBody(await res.text()) as T;
}

/**
 * The filename a download names itself with (`Content-Disposition`), or the
 * fallback. Quoted and RFC 5987 forms are both accepted.
 */
export function filenameFrom(res: Response, fallback: string): string {
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(disposition);
  if (!match) return fallback;
  try {
    return decodeURIComponent(match[1].replace(/"/g, ''));
  } catch {
    return fallback;
  }
}
