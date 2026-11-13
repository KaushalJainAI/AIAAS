/**
 * "5m ago", "3h ago", "2d ago", then a short date. Pure, so it is cheap to call
 * on every row render.
 */
export function timeAgo(iso: string, now: number = Date.now()): string {
  // Django emits microseconds ("...00.123456Z"); not every JS engine parses more
  // than milliseconds, so trim the fraction to three digits first.
  const then = Date.parse(iso.replace(/(\.\d{3})\d+/, '$1'));
  if (Number.isNaN(then)) return '';

  const mins = Math.max(0, Math.floor((now - then) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
