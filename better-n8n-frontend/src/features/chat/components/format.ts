/**
 * Small text helpers shared by the chat transcript pieces.
 */

/** Rough size hint for a reasoning trace, so the toggle says what it will cost to open. */
export function formatWordCount(text: string): string {
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return '';
  if (words < 1000) return `${words} words`;
  return `${(words / 1000).toFixed(1)}k words`;
}

/**
 * A tool-argument field as text. `StreamActivity.args` is `Record<string,
 * unknown>` because the wire carries no schema for it, so anything rendered
 * out of it has to be narrowed rather than trusted.
 */
export const argText = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Strips XML/HTML-looking tags from a tool-call argument before showing it. */
export const stripXmlTags = (val: unknown): string => {
  if (typeof val !== 'string') return String(val ?? '');
  return val.replace(/<\/?[a-zA-Z_][a-zA-Z0-9_:.-]*[^>]*>/g, '').trim();
};

/** A message's time as the transcript shows it, e.g. "14:05". Empty when unknown. */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * A turn's duration for the block header: "4s", "1m 12s". Empty when the
 * server did not send a figure, so the caller can leave the time out.
 */
export function formatElapsed(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Initials for an agent badge: the first letters of the first two words, or the first two letters of one word. */
export function badgeInitials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'AG';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** "3 steps" / "1 step", for the block header. */
export function formatSteps(count: number): string {
  return count === 1 ? '1 step' : `${count} steps`;
}

/**
 * How a person's own messages are signed: their display name (an email is
 * shortened to the part before the @) and initials for the avatar. With no
 * name — a guest — it is "You".
 */
export function personLabel(name: string | null | undefined): { name: string; initials: string } {
  const raw = (name ?? '').trim();
  if (!raw) return { name: 'You', initials: 'You' };
  const shown = raw.includes('@') ? raw.split('@')[0] : raw;
  const words = shown.split(/[\s._-]+/).filter(Boolean);
  const initials = words.length >= 2
    ? words[0][0] + words[words.length - 1][0]
    : (words[0] ?? shown).slice(0, 2);
  return { name: shown, initials: initials.toUpperCase() };
}
