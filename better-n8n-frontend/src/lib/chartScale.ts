/**
 * The arithmetic behind a chart's y axis.
 *
 * Separate from `ChartArtifact.tsx` because it is the part that can be wrong
 * *numerically* rather than visually — a tick that does not bracket the data,
 * a mark placed outside the plot, a flat series collapsing onto one line — and
 * those are the failures a screenshot is worst at catching and a test is best
 * at. The component keeps the drawing; this keeps the scale.
 */

/**
 * Round tick values that bracket `[min, max]`.
 *
 * Every returned tick is a value the axis actually reaches, which is the rule
 * that keeps a gridline label from naming a number the chart does not contain.
 * A flat series (min === max) is padded rather than left with a zero-height
 * range: without it every mark lands on one line and the chart says nothing.
 */
export function ticksFor(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const pad = Math.abs(min) || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** Compact axis and tooltip numbers. Full precision belongs in the table view. */
export function formatValue(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}
