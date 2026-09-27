/**
 * Shared paging types for DRF list endpoints.
 *
 * DRF pages collections at a fixed size, and function views may return either a
 * paged envelope or a bare array. Carrying `count` lets a screen say out loud
 * when a list is truncated rather than silently dropping rows.
 */

/** DRF's paged envelope. Sub-resources use it; top-level lists may not. */
export interface Page<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/**
 * A list plus how many exist in total.
 *
 * Returning a bare array would silently drop everything past the first page —
 * the list would look complete and be wrong. Carrying `count` lets the screen
 * say so out loud.
 */
export interface Listing<T> {
  items: T[];
  count: number;
}
