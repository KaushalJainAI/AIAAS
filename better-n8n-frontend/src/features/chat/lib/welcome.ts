/**
 * Small pure helpers for the empty chat screen: the greeting, the first name
 * it uses, and the short "2h" ages beside recent conversations.
 */

/** "Good morning" before noon, "Good afternoon" until six, then "Good evening". */
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** The first word of a display name, or the part of an email before the @.
 *  Empty when there is nothing to go on, so the caller can leave it out. */
export function firstName(name?: string | null): string {
  const text = (name ?? '').trim();
  if (!text) return '';
  const base = text.includes('@') ? text.split('@')[0] : text;
  const first = base.split(/\s+/)[0] ?? '';
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** "now", "5m", "3h", "2d", then a short date. */
export function shortAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const seconds = Math.max(0, (now.getTime() - then.getTime()) / 1000);
  if (Number.isNaN(seconds)) return '';
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
