/**
 * Normalises list responses at the API boundary.
 *
 * Some endpoints return a bare array, some return DRF's paginated envelope
 * ({count, next, previous, results}), and a few services are typed as plain
 * arrays regardless. TypeScript takes the signature at its word, so the
 * mismatch only surfaces as a runtime "x.filter is not a function" at whichever
 * call site touches it first — usually far from the cause.
 *
 * Accepting either shape here is cheaper than keeping every signature in sync
 * with pagination settings that live in the backend.
 */
export function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const results = (data as { results?: unknown }).results;
    if (Array.isArray(results)) return results as T[];
  }
  return [];
}
