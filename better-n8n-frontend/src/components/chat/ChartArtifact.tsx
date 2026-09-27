import { useMemo, useState } from 'react';
import { Table2, BarChart3 } from 'lucide-react';
import type { ChartPoint, ChartSpec, ChartSeries } from '../../api/chat';
import { formatValue as fmt, ticksFor } from '../../lib/chartScale';

/**
 * Renders a chart the model described as *data*, never as markup.
 *
 * The model sends `{kind, title, series, ...}` and this file owns every visual
 * decision: palette, scale, gridlines, labels, dark mode, the table view. That
 * split is the whole point. Charts used to arrive as hand-authored SVG inside
 * `render_html_artifact`, which meant asking a language model to be a rendering
 * engine — labels ran off the edge, dark mode was whatever it remembered, and
 * the same question twice produced two different-looking products.
 *
 * ## Colour
 *
 * The categorical ramp below is a fixed, validated order — not a generator. It
 * was checked against this app's real surfaces (#ffffff light, #141414 dark)
 * for the lightness band, chroma floor, adjacent-pair separation under
 * colour-vision deficiency, and contrast. Three light-mode hues (aqua, yellow,
 * magenta) sit under 3:1 on white, which obliges *relief*: identity is never
 * carried by colour alone here — every series is named in the legend, and the
 * table view below is one click away. Do not add a ninth colour: the backend
 * refuses a ninth series for exactly this reason, and an invented hue is one
 * nobody checked.
 *
 * ## Scale
 *
 * One scale places the marks, the ticks and the labels, so every gridline
 * names a value the chart actually reaches. There is deliberately no second
 * y-axis: two measures of different magnitude get two charts, which is what
 * the tool description tells the model.
 */

// The slot order lives once, as CSS custom properties in the <style> block
// below, so light and dark swap in one place and every mark reads a role
// (`var(--c3)`) rather than a hex. Index into the slots; never cycle past
// eight, never generate a hue.

const PAD = { top: 18, right: 18, bottom: 46, left: 56 };
const HEIGHT = 260;
const WIDTH = 640;

interface Props {
  chart: ChartSpec;
}

export default function ChartArtifact({ chart }: Props) {
  const [showTable, setShowTable] = useState(false);
  const [hover, setHover] = useState<{ x: number; label: string; rows: string[] } | null>(null);

  // Memoised so the scale and category memos below have a stable dependency:
  // a fresh `[]` on every render would recompute both on every render.
  const series: ChartSeries[] = useMemo(
    () => (Array.isArray(chart.series) ? chart.series : []),
    [chart.series],
  );
  const kind = chart.kind || 'column';

  // Every distinct x, in the order the first series introduced it. Categories
  // come from the data rather than from a sorted set, because "Jan, Feb, Mar"
  // must not become "Feb, Jan, Mar".
  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const s of series) {
      for (const p of s.points || []) {
        if (!seen.includes(p.x)) seen.push(p.x);
      }
    }
    return seen;
  }, [series]);

  const stacked = Boolean(chart.stacked) && kind !== 'line' && kind !== 'scatter';

  const { min, max } = useMemo(() => {
    let lo = 0;
    let hi = 0;
    if (stacked) {
      for (const cat of categories) {
        let sum = 0;
        for (const s of series) {
          const p = (s.points || []).find(pt => pt.x === cat);
          if (p && typeof p.y === 'number') sum += p.y;
        }
        hi = Math.max(hi, sum);
        lo = Math.min(lo, sum);
      }
    } else {
      for (const s of series) {
        for (const p of s.points || []) {
          if (typeof p.y !== 'number') continue;
          hi = Math.max(hi, p.y);
          lo = Math.min(lo, p.y);
        }
      }
    }
    return { min: lo, max: hi };
  }, [series, categories, stacked]);

  const ticks = useMemo(() => ticksFor(min, max), [min, max]);
  const yLo = ticks[0];
  const yHi = ticks[ticks.length - 1];

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const yFor = (v: number) => PAD.top + plotH - ((v - yLo) / (yHi - yLo || 1)) * plotH;
  const xFor = (i: number) =>
    categories.length <= 1
      ? PAD.left + plotW / 2
      : PAD.left + (i / (categories.length - 1)) * plotW;

  const valueAt = (s: ChartSeries, cat: string): number | null => {
    const p = (s.points || []).find(pt => pt.x === cat);
    return p && typeof p.y === 'number' ? p.y : null;
  };

  // Only show every nth category label when they would collide. Rotating or
  // shrinking them is worse: an unreadable label is the same as none, and it
  // still costs the space.
  const labelStride = Math.max(1, Math.ceil(categories.length / 8));

  const isPie = kind === 'pie';
  const isBarLike = kind === 'bar' || kind === 'column';

  const showHover = (i: number, cat: string) => {
    setHover({
      // Percent of the viewBox, so the tooltip tracks the mark when the SVG is
      // scaled to whatever width the bubble happens to be.
      x: (xFor(i) / WIDTH) * 100,
      label: cat,
      rows: series.map(s => {
        const v = valueAt(s, cat);
        return `${s.name}: ${v === null ? '—' : fmt(v)}`;
      }),
    });
  };

  return (
    <figure
      className="chart-figure group/chart my-3 overflow-hidden rounded-lg border border-border bg-card
                 animate-in fade-in slide-in-from-bottom-2 duration-500"
    >
      <style>{`
        .chart-figure {
          --c1:#2a78d6; --c2:#eb6834; --c3:#1baf7a; --c4:#eda100;
          --c5:#e87ba4; --c6:#008300; --c7:#4a3aa7; --c8:#e34948;
          --grid: rgba(0,0,0,0.09);
          --axis: rgba(0,0,0,0.28);
        }
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme="light"]) .chart-figure {
            --c1:#3987e5; --c2:#d95926; --c3:#199e70; --c4:#c98500;
            --c5:#d55181; --c6:#008300; --c7:#9085e9; --c8:#e66767;
            --grid: rgba(255,255,255,0.10);
            --axis: rgba(255,255,255,0.32);
          }
        }
        :root[data-theme="dark"] .chart-figure {
          --c1:#3987e5; --c2:#d95926; --c3:#199e70; --c4:#c98500;
          --c5:#d55181; --c6:#008300; --c7:#9085e9; --c8:#e66767;
          --grid: rgba(255,255,255,0.10);
          --axis: rgba(255,255,255,0.32);
        }
      `}</style>

      <figcaption className="flex items-start gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-foreground">{chart.title}</div>
          {chart.note ? (
            <div className="truncate text-[11px] text-muted-foreground">{chart.note}</div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setShowTable(v => !v)}
          aria-pressed={showTable}
          title={showTable ? 'Show chart' : 'Show the numbers as a table'}
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {showTable ? <BarChart3 className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}
        </button>
      </figcaption>

      {showTable ? (
        <div className="max-h-[320px] overflow-auto p-3">
          <table className="w-full border-collapse text-[12px] tabular-nums">
            <thead>
              <tr>
                <th className="border-b border-border px-2 py-1 text-left font-medium text-muted-foreground">
                  {chart.x_label || ''}
                </th>
                {series.map(s => (
                  <th key={s.name} className="border-b border-border px-2 py-1 text-right font-medium text-muted-foreground">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map(cat => (
                <tr key={cat}>
                  <td className="border-b border-border/50 px-2 py-1 text-foreground">{cat}</td>
                  {series.map(s => {
                    const v = valueAt(s, cat);
                    return (
                      <td key={s.name} className="border-b border-border/50 px-2 py-1 text-right text-foreground">
                        {v === null ? '—' : fmt(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative overflow-x-auto p-2">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            width="100%"
            role="img"
            aria-label={`${chart.title}. ${series.length} series. Use the table button to read the values.`}
            style={{ display: 'block', minWidth: 320 }}
            onMouseLeave={() => setHover(null)}
          >
            {isPie ? (
              <PieMarks series={series} />
            ) : (
              <>
                {/* Gridlines and y labels come from the same tick list as the
                    scale, so a label can never name a value the chart does not
                    reach. */}
                {ticks.map(t => (
                  <g key={t}>
                    <line
                      x1={PAD.left} x2={WIDTH - PAD.right}
                      y1={yFor(t)} y2={yFor(t)}
                      stroke="var(--grid)" strokeWidth={1}
                    />
                    <text
                      x={PAD.left - 8} y={yFor(t)}
                      textAnchor="end" dominantBaseline="middle"
                      fontSize={10} fill="currentColor"
                      className="text-muted-foreground"
                    >
                      {fmt(t)}
                    </text>
                  </g>
                ))}
                {/* Zero line drawn darker when the data crosses it: the
                    baseline is a fact about the data, not decoration. */}
                {yLo < 0 && yHi > 0 ? (
                  <line
                    x1={PAD.left} x2={WIDTH - PAD.right}
                    y1={yFor(0)} y2={yFor(0)}
                    stroke="var(--axis)" strokeWidth={1}
                  />
                ) : null}

                {categories.map((cat, i) =>
                  i % labelStride === 0 ? (
                    <text
                      key={cat}
                      x={isBarLike ? bandCentre(i, categories.length) : xFor(i)}
                      y={HEIGHT - PAD.bottom + 16}
                      textAnchor="middle"
                      fontSize={10} fill="currentColor"
                      className="text-muted-foreground"
                    >
                      {cat.length > 12 ? `${cat.slice(0, 11)}…` : cat}
                    </text>
                  ) : null,
                )}

                {kind === 'area' || kind === 'line' ? (
                  <LineMarks
                    series={series} categories={categories} kind={kind}
                    xFor={xFor} yFor={yFor} valueAt={valueAt}
                    baseline={yFor(Math.max(yLo, 0))}
                  />
                ) : null}

                {isBarLike ? (
                  <BarMarks
                    series={series} categories={categories} stacked={stacked}
                    yFor={yFor} valueAt={valueAt} zero={yFor(Math.max(yLo, 0))}
                  />
                ) : null}

                {kind === 'scatter' ? (
                  <ScatterMarks
                    series={series} categories={categories}
                    xFor={xFor} yFor={yFor} valueAt={valueAt}
                  />
                ) : null}

                {/* Hover targets are full-height bands, much bigger than the
                    marks, so a thin line is still easy to hit. */}
                {categories.map((cat, i) => (
                  <rect
                    key={`hit-${cat}`}
                    x={isBarLike ? bandStart(i, categories.length) : xFor(i) - plotW / Math.max(categories.length, 1) / 2}
                    y={PAD.top}
                    width={plotW / Math.max(categories.length, 1)}
                    height={plotH}
                    fill="transparent"
                    onMouseEnter={() => showHover(i, cat)}
                  />
                ))}
              </>
            )}

            {chart.y_label ? (
              <text
                x={12} y={PAD.top + plotH / 2}
                transform={`rotate(-90 12 ${PAD.top + plotH / 2})`}
                textAnchor="middle" fontSize={10} fill="currentColor"
                className="text-muted-foreground"
              >
                {chart.y_label}
              </text>
            ) : null}
            {chart.x_label ? (
              <text
                x={PAD.left + plotW / 2} y={HEIGHT - 6}
                textAnchor="middle" fontSize={10} fill="currentColor"
                className="text-muted-foreground"
              >
                {chart.x_label}
              </text>
            ) : null}
          </svg>

          {hover ? (
            <div
              className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-md border border-border
                         bg-popover px-2 py-1 text-[11px] shadow-md"
              style={{ left: `${hover.x}%` }}
            >
              <div className="font-medium text-foreground">{hover.label}</div>
              {hover.rows.map(r => (
                <div key={r} className="tabular-nums text-muted-foreground">{r}</div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* A legend whenever identity could be ambiguous. One series needs none —
          the title already names it — which is also why a lone series is not
          given a coloured chip it does not need. */}
      {series.length > 1 && !showTable ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border/60 px-3 py-1.5">
          {series.map((s, i) => (
            <span key={s.name} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
                style={{ background: `var(--c${(i % 8) + 1})` }}
              />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}
    </figure>
  );
}

// ── Mark specs ───────────────────────────────────────────────────────────────
// Each kind draws its own marks. Split out so the axis/scale code above is read
// once rather than once per chart type.

const plotW = WIDTH - PAD.left - PAD.right;
const plotH = HEIGHT - PAD.top - PAD.bottom;

const bandStart = (i: number, n: number) => PAD.left + (i / Math.max(n, 1)) * plotW;
const bandCentre = (i: number, n: number) => bandStart(i, n) + plotW / Math.max(n, 1) / 2;

function LineMarks({
  series, categories, kind, xFor, yFor, valueAt, baseline,
}: {
  series: ChartSeries[]; categories: string[]; kind: string;
  xFor: (i: number) => number; yFor: (v: number) => number;
  valueAt: (s: ChartSeries, cat: string) => number | null;
  baseline: number;
}) {
  return (
    <>
      {series.map((s, si) => {
        const colour = `var(--c${(si % 8) + 1})`;
        // Gaps rather than joins across missing points: a line drawn straight
        // through a hole invents data that was never measured.
        const runs: { i: number; v: number }[][] = [];
        let run: { i: number; v: number }[] = [];
        categories.forEach((cat, i) => {
          const v = valueAt(s, cat);
          if (v === null) { if (run.length) runs.push(run); run = []; }
          else run.push({ i, v });
        });
        if (run.length) runs.push(run);

        return (
          <g key={s.name}>
            {kind === 'area' && runs.map((r, ri) => (
              <path
                key={`a${ri}`}
                d={`M ${xFor(r[0].i)} ${baseline} ` +
                   r.map(pt => `L ${xFor(pt.i)} ${yFor(pt.v)}`).join(' ') +
                   ` L ${xFor(r[r.length - 1].i)} ${baseline} Z`}
                fill={colour}
                fillOpacity={0.16}
              />
            ))}
            {runs.map((r, ri) => (
              <path
                key={`l${ri}`}
                d={r.map((pt, k) => `${k ? 'L' : 'M'} ${xFor(pt.i)} ${yFor(pt.v)}`).join(' ')}
                fill="none"
                stroke={colour}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {/* A lone point would otherwise be invisible: a one-point run has
                no line to draw. */}
            {runs.filter(r => r.length === 1).map((r, ri) => (
              <circle key={`d${ri}`} cx={xFor(r[0].i)} cy={yFor(r[0].v)} r={4} fill={colour} />
            ))}
          </g>
        );
      })}
    </>
  );
}

function BarMarks({
  series, categories, stacked, yFor, valueAt, zero,
}: {
  series: ChartSeries[]; categories: string[]; stacked: boolean;
  yFor: (v: number) => number;
  valueAt: (s: ChartSeries, cat: string) => number | null;
  zero: number;
}) {
  const band = plotW / Math.max(categories.length, 1);
  // 2px of surface between adjacent fills, so touching bars read as two marks
  // rather than one wide one.
  const GAP = 2;
  const inner = band * 0.72;
  const each = stacked ? inner : (inner - GAP * (series.length - 1)) / series.length;

  return (
    <>
      {categories.map((cat, ci) => {
        let stackTop = zero;
        return (
          <g key={cat}>
            {series.map((s, si) => {
              const v = valueAt(s, cat);
              if (v === null) return null;
              const colour = `var(--c${(si % 8) + 1})`;
              const y = yFor(v);
              const left = bandStart(ci, categories.length) + (band - inner) / 2;

              if (stacked) {
                const h = Math.abs(zero - y);
                const top = stackTop - h;
                stackTop = top;
                return (
                  <rect
                    key={s.name} x={left} y={top} width={each}
                    height={Math.max(0, h - GAP)} fill={colour} rx={2}
                  />
                );
              }
              const top = Math.min(y, zero);
              const h = Math.abs(zero - y);
              return (
                <rect
                  key={s.name}
                  x={left + si * (each + GAP)}
                  y={top}
                  width={Math.max(1, each)}
                  height={Math.max(1, h)}
                  fill={colour}
                  rx={2}
                />
              );
            })}
          </g>
        );
      })}
    </>
  );
}

function ScatterMarks({
  series, categories, xFor, yFor, valueAt,
}: {
  series: ChartSeries[]; categories: string[];
  xFor: (i: number) => number; yFor: (v: number) => number;
  valueAt: (s: ChartSeries, cat: string) => number | null;
}) {
  return (
    <>
      {series.map((s, si) => (
        <g key={s.name}>
          {categories.map((cat, i) => {
            const v = valueAt(s, cat);
            if (v === null) return null;
            return (
              <circle
                key={cat} cx={xFor(i)} cy={yFor(v)} r={4.5}
                fill={`var(--c${(si % 8) + 1})`}
                // A 2px surface ring keeps overlapping dots readable as two
                // marks instead of one blob.
                stroke="var(--background, #fff)" strokeWidth={2}
              />
            );
          })}
        </g>
      ))}
    </>
  );
}

function PieMarks({ series }: { series: ChartSeries[] }) {
  const points = (series[0]?.points || []).filter(p => typeof p.y === 'number' && (p.y as number) > 0);
  const total = points.reduce((sum, p) => sum + (p.y as number), 0);
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const r = Math.min(plotH, 200) / 2;

  if (!total) {
    return (
      <text x={cx} y={cy} textAnchor="middle" fontSize={11} fill="currentColor"
            className="text-muted-foreground">
        No positive values to chart.
      </text>
    );
  }

  // Geometry is computed up front rather than accumulated inside the render
  // callback: a running angle mutated during render is state pretending to be
  // a local, and it reads inconsistently if React re-renders mid-list.
  const slices: { p: ChartPoint; start: number; end: number; sweep: number; pct: number }[] = [];
  for (const p of points) {
    const sweep = ((p.y as number) / total) * Math.PI * 2;
    const start = slices.length ? slices[slices.length - 1].end : -Math.PI / 2;
    slices.push({ p, start, end: start + sweep, sweep, pct: ((p.y as number) / total) * 100 });
  }

  return (
    <>
      {slices.map(({ p, start, end, sweep, pct }, i) => {
        const x1 = cx + r * Math.cos(start);
        const y1 = cy + r * Math.sin(start);
        const x2 = cx + r * Math.cos(end);
        const y2 = cy + r * Math.sin(end);
        const mid = start + sweep / 2;
        return (
          <g key={p.x}>
            <path
              d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`}
              fill={`var(--c${(i % 8) + 1})`}
              stroke="var(--background, #fff)"
              strokeWidth={2}
            />
            {/* Direct labels on slices big enough to hold one. This is the
                relief the light palette obliges: identity never rests on
                colour alone. */}
            {pct >= 8 ? (
              <text
                x={cx + r * 0.68 * Math.cos(mid)}
                y={cy + r * 0.68 * Math.sin(mid)}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={10} fontWeight={600} fill="#fff"
              >
                {pct.toFixed(0)}%
              </text>
            ) : null}
          </g>
        );
      })}
      {points.map((p, i) => (
        <text
          key={`lg-${p.x}`}
          x={WIDTH - PAD.right}
          y={PAD.top + 12 + i * 14}
          textAnchor="end" fontSize={10} fill="currentColor"
          className="text-muted-foreground"
        >
          {p.x}
        </text>
      ))}
    </>
  );
}
