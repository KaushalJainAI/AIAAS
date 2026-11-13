/**
 * The arithmetic behind a chart's y axis. Port of better-n8n-frontend/src/lib/chartScale.ts.
 * Kept apart from the drawing because a tick that does not bracket the data is a
 * numerical failure a picture is bad at catching.
 */

/**
 * Round tick values that bracket `[min, max]`. Every tick is a value the axis
 * reaches, so a gridline never names a number the chart does not contain. A
 * flat series is padded rather than left with a zero-height range.
 */
export function ticksFor(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  let lo = min;
  let hi = max;
  if (lo === hi) {
    const pad = Math.abs(lo) || 1;
    lo -= pad;
    hi += pad;
  }
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
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
