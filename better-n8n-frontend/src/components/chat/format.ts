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
