/**
 * Pure helpers for the conversation list: the title a row shows, the title
 * search, and the day buckets (Today, Yesterday, Previous 7 days, Older).
 *
 * Days are the user's local calendar days, so a conversation updated at 00:05
 * is "Today" for the person who is awake at 00:05, whatever the server's zone.
 */

/** Shown for a conversation with no title (or only spaces). */
export const UNTITLED_LABEL = 'Untitled conversation';

/** The model's limit on a conversation title. */
export const TITLE_MAX_LENGTH = 255;

export type DayLabel = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Older';

export interface DayGroup<T> {
  label: DayLabel;
  items: T[];
}

/** Newest bucket first, the order the list is drawn in. */
const DAY_ORDER: readonly DayLabel[] = ['Today', 'Yesterday', 'Previous 7 days', 'Older'];

/** The title a row shows: the saved title, or "Untitled conversation". */
export function displayTitle(conv: { title?: string | null }): string {
  const title = (conv.title ?? '').trim();
  return title || UNTITLED_LABEL;
}

/**
 * Conversations whose shown title contains `query`, case insensitive. An empty
 * or blank query keeps everything, in the order it was given.
 */
export function filterByTitle<T extends { title?: string | null }>(
  items: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  return items.filter((item) => displayTitle(item).toLowerCase().includes(needle));
}

/** Midnight at the start of `date`'s local day. */
function startOfDay(date: Date): Date {
  const start = new Date(date.getTime());
  start.setHours(0, 0, 0, 0);
  return start;
}

/** Local calendar arithmetic: `setDate` keeps midnight even across a DST change. */
function addDays(date: Date, days: number): Date {
  const shifted = new Date(date.getTime());
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

function dayLabelFor(
  updatedAt: string | null | undefined,
  bounds: { today: number; yesterday: number; weekAgo: number },
): DayLabel {
  const time = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  // Unknown or unreadable dates sit at the bottom rather than in "Today".
  if (Number.isNaN(time)) return 'Older';
  // A time after midnight today (including a small clock skew into the future)
  // is Today.
  if (time >= bounds.today) return 'Today';
  if (time >= bounds.yesterday) return 'Yesterday';
  if (time >= bounds.weekAgo) return 'Previous 7 days';
  return 'Older';
}

/**
 * Splits `items` into the day buckets by `updated_at`, relative to `now`. Empty
 * buckets are left out. Order inside a bucket is the order given.
 */
export function groupByDay<T extends { updated_at?: string | null }>(
  items: readonly T[],
  now: Date,
): DayGroup<T>[] {
  const today = startOfDay(now);
  const bounds = {
    today: today.getTime(),
    yesterday: addDays(today, -1).getTime(),
    weekAgo: addDays(today, -7).getTime(),
  };

  const buckets: Record<DayLabel, T[]> = {
    Today: [],
    Yesterday: [],
    'Previous 7 days': [],
    Older: [],
  };
  for (const item of items) {
    buckets[dayLabelFor(item.updated_at, bounds)].push(item);
  }

  return DAY_ORDER.filter((label) => buckets[label].length > 0).map((label) => ({
    label,
    items: buckets[label],
  }));
}
