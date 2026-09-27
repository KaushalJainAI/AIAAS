/**
 * The message to show a user when an API call fails.
 *
 * Every call site had grown its own version of `err.response?.data?.error ||
 * err.message || 'Something failed'`, each typed `catch (err: any)` because
 * `unknown` makes that chain a compile error. They had already drifted: some
 * read `error`, some `detail`, and none of them read DRF's field-error shape
 * (`{"cron": ["Expected five cron fields."]}`), so a validation failure showed
 * the generic fallback and the user never saw which field was wrong.
 *
 * Narrowing happens once, here, which is what lets every caller keep `unknown`.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: unknown } } | null)?.response?.data;

  if (typeof data === 'string' && data.trim()) return data;

  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    // The two shapes this API returns deliberately.
    for (const key of ['error', 'detail', 'message']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    // DRF field errors: {"cron": ["Expected five cron fields."]}. The first one
    // is the one to show — a list of every field is not a sentence.
    for (const value of Object.values(record)) {
      if (typeof value === 'string' && value.trim()) return value;
      if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim()) {
        return value[0];
      }
    }
  }

  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
