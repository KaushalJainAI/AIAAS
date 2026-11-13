/** Number formats for the "What the assistant sees" tab. */

/** 950 → "950", 1 250 → "1.3k", 128 000 → "128k", 2 100 000 → "2.1M". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** A 0–1 rate as a whole percentage; "—" when there is nothing to measure. */
export function formatRate(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`;
}
