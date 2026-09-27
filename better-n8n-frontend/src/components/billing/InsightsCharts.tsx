/**
 * Insights charts — dependency-free SVG/divs, one shared color language.
 *
 * See `lib/insights.ts`: emerald succeeded, red failed, amber waiting on a
 * person, blue volume-without-verdict, muted everything else. Every chart
 * here encodes reliability as hue *and* as text/position, so nothing rests
 * on color alone.
 */

import { useId } from 'react';
import { dayFailed, dayRate, statusStroke } from '../../lib/insights';

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
      <span>{label}</span>
    </span>
  );
}

/** The palette key, rendered once under the header so no card re-explains it. */
export function ChartLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <Swatch color="#10b981" label="Succeeded" />
      <Swatch color="#ef4444" label="Failed" />
      <Swatch color="#f59e0b" label="Waiting on you" />
      <Swatch color="#3b82f6" label="Volume" />
    </div>
  );
}

/** Runs per day, stacked: emerald successes below, the rest (failed, paused,
 *  cancelled) in red above. A bad day looks bad — the old single-hue bars
 *  showed a 100%-failure day identically to a perfect one. */
export function RunsDayBars({ daily, max }: {
  daily: { date: string | null; count: number; success: number }[];
  max: number;
}) {
  const days = daily.slice(-30);
  return (
    <div className="h-44 flex items-end gap-1" role="img" aria-label="Runs per day, stacked by outcome">
      {days.map((d, i) => {
        const failed = dayFailed(d);
        const rate = dayRate(d);
        const key = d.date ?? `day-${i}`;
        return (
          <div
            key={key}
            className="flex-1 flex flex-col justify-end h-full"
            title={`${d.date ?? 'unknown date'}: ${d.count} runs · ${d.success} ok${rate == null ? '' : ` · ${rate.toFixed(0)}%`}`}
          >
            <div
              className="w-full bg-red-500/70 rounded-t-sm min-h-[2px]"
              style={{ height: `${(failed / max) * 100}%` }}
            />
            <div
              className="w-full bg-emerald-500/70 min-h-[2px]"
              style={{ height: `${(d.success / max) * 100}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Model spend per day. Money is emerald everywhere on this page; the height,
 *  not the hue, carries the comparison. */
export function SpendDayBars({ daily, max }: {
  daily: { date: string | null; cost: number }[];
  max: number;
}) {
  return (
    <div className="h-20 flex items-end gap-1" role="img" aria-label="Spend per day">
      {daily.slice(-30).map((d, i) => (
        <div
          key={d.date ?? `day-${i}`}
          className="flex-1 flex flex-col justify-end h-full"
          title={`${d.date ?? 'unknown date'}: $${d.cost.toFixed(4)}`}
        >
          <div
            className="w-full bg-emerald-500/60 rounded-t-sm min-h-[2px]"
            style={{ height: `${max > 0 ? (d.cost / max) * 100 : 0}%` }}
          />
        </div>
      ))}
    </div>
  );
}

const TREND_W = 560;
const TREND_H = 96;
const TREND_PAD = 8;

/** Daily success rate as a line, segmented by band with an 80% guide. Empty
 *  days break the line (a gap) rather than dragging it to zero — nothing ran,
 *  so there is no rate to plot. */
export function RateTrend({ daily }: {
  daily: { date: string | null; count: number; success: number }[];
}) {
  const gid = useId();
  const days = daily.slice(-30);
  const n = Math.max(days.length, 1);
  const x = (i: number) => TREND_PAD + (i / Math.max(n - 1, 1)) * (TREND_W - TREND_PAD * 2);
  const y = (rate: number) => TREND_H - TREND_PAD - (rate / 100) * (TREND_H - TREND_PAD * 2);
  const strokeFor = (rate: number) =>
    rate >= 95 ? '#10b981' : rate >= 80 ? '#f59e0b' : '#ef4444';

  // Segments split wherever the band changes or a gap day intervenes, so one
  // bad day cannot dye its neighbours. Each segment is one polyline.
  const segments: { rate: number; points: string }[][] = [];
  let current: { rate: number; points: string }[] = [];
  const flush = () => {
    if (current.length > 1) segments.push(current);
    current = [];
  };
  days.forEach((d, i) => {
    const rate = dayRate(d);
    if (rate == null) {
      flush();
      return;
    }
    const pt = { rate, points: `${x(i)},${y(rate)}` };
    const prev = current[current.length - 1];
    if (prev && strokeFor(prev.rate) !== strokeFor(rate)) flush();
    current.push(pt);
  });
  flush();

  return (
    <svg
      viewBox={`0 0 ${TREND_W} ${TREND_H}`}
      className="w-full h-24"
      role="img"
      aria-label="Daily success rate trend"
    >
      <defs>
        <clipPath id={gid}>
          <rect x="0" y="0" width={TREND_W} height={TREND_H} rx="4" />
        </clipPath>
      </defs>
      <line
        x1={TREND_PAD} x2={TREND_W - TREND_PAD} y1={y(80)} y2={y(80)}
        stroke="#f59e0b" strokeWidth="1" strokeDasharray="5 4" opacity="0.7"
      />
      <g clipPath={`url(#${gid})`}>
        {segments.map((seg, si) => (
          <polyline
            key={si}
            points={seg.map((p) => p.points).join(' ')}
            fill="none"
            stroke={strokeFor(seg[0].rate)}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {days.map((d, i) => {
          const rate = dayRate(d);
          if (rate == null) return null;
          return (
            <circle key={d.date ?? `day-${i}`} cx={x(i)} cy={y(rate)} r="3" fill={strokeFor(rate)}>
              <title>{`${d.date ?? 'unknown date'}: ${rate.toFixed(0)}% (${d.success}/${d.count})`}</title>
            </circle>
          );
        })}
      </g>
    </svg>
  );
}

/** Run outcomes as a donut. Slices use the status palette; the center number
 *  is the total, so the chart answers "how many" without the tooltip. */
export function StatusDonut({ byStatus }: { byStatus: Record<string, number> }) {
  const entries = Object.entries(byStatus).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  const R = 44;
  const C = 2 * Math.PI * R;
  /* Slice start offsets, computed before the return: accumulating in a
     running variable reassigns during render, which the immutability rule
     forbids — each start is a pure function of its index instead. */
  const fracs = entries.map(([, n]) => (total ? n / total : 0));
  const slices = entries.map(([status, n], i) => ({
    status,
    n,
    start: fracs.slice(0, i).reduce((a, f) => a + f, 0),
  }));
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 120 120" className="w-28 h-28 shrink-0" role="img" aria-label="Runs by status">
        <circle cx="60" cy="60" r={R} fill="none" stroke="#9ca3af" strokeOpacity="0.25" strokeWidth="16" />
        {slices.map(({ status, n, start }) => {
          if (!total) return null;
          const frac = n / total;
          return (
            <circle
              key={status}
              cx="60"
              cy="60"
              r={R}
              fill="none"
              stroke={statusStroke(status)}
              strokeWidth="16"
              strokeDasharray={`${frac * C} ${C}`}
              strokeDashoffset={-start * C}
              transform="rotate(-90 60 60)"
            >
              <title>{`${status}: ${n} runs`}</title>
            </circle>
          );
        })}
        <text x="60" y="58" textAnchor="middle" fontSize="20" fontWeight="700" fill="currentColor">
          {total.toLocaleString()}
        </text>
        <text x="60" y="74" textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.6">
          runs
        </text>
      </svg>
      <ul className="space-y-1.5 text-xs">
        {entries.map(([status, n]) => (
          <li key={status} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: statusStroke(status) }} />
            <span className="text-muted-foreground capitalize">{status.replace('_', ' ')}</span>
            <span className="tabular-nums font-medium ml-auto pl-3">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One tool's volume with its failures inside it: width is share of the
 *  busiest tool (blue would lie about reliability, full-width red would lie
 *  about volume), the red segment is the failed share. */
export function ToolShareBar({ calls, failed, maxCalls }: {
  calls: number;
  failed: number;
  maxCalls: number;
}) {
  const width = maxCalls > 0 ? (calls / maxCalls) * 100 : 0;
  const failShare = calls > 0 ? (failed / calls) * 100 : 0;
  return (
    <div className="h-1.5 rounded-full bg-muted overflow-hidden" role="img" aria-label={`${calls} calls, ${failed} failed`}>
      <div className="h-full rounded-full flex" style={{ width: `${Math.min(100, Math.max(0, width))}%` }}>
        <div className="h-full bg-blue-500/60" style={{ width: `${100 - failShare}%` }} />
        {failShare > 0 && <div className="h-full bg-red-500/80" style={{ width: `${failShare}%` }} />}
      </div>
    </div>
  );
}
