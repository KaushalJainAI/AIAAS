/**
 * Run `task` over `items`, at most `limit` at a time.
 *
 * The file picker is `multiple`, and `Promise.all` over the selection sent
 * every file at once: two hundred files were two hundred simultaneous 50 MB
 * requests. This keeps a fixed number in flight and starts the next as one
 * finishes.
 *
 * Settles like `Promise.allSettled`: one failure never stops the rest, and
 * results come back in the order of `items`, not of completion.
 */
export async function runLimited<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}

/** Uploads in flight at once from one selection or drop. */
export const UPLOAD_CONCURRENCY = 3;
