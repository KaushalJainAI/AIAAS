/**
 * A chart the model described as data, drawn with react-native-svg. Port of
 * better-n8n-frontend/src/components/chat/ChartArtifact.tsx with the same rules:
 * one scale places the marks, the ticks and the labels; a missing value is a gap
 * (a line breaks, a bar is absent), never a zero; a series is named in the legend
 * so identity never rests on colour alone; the table view is one tap away.
 *
 * Colours come from the theme's semantic tokens, cycled in a fixed order, because
 * DESIGN.md forbids hex literals in feature code. Pie charts are drawn; the
 * web's hover tooltip is replaced by the table view on a phone.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { Icon } from '../../components/Icon';
import { Text } from '../../components/Text';
import { fontFamily } from '../../fonts';
import { formatValue, ticksFor } from './chartScale';
import { spacing, useTheme } from '../../theme';
import type { ChartSeries, ChartSpec } from './types';

const WIDTH = 640;
const HEIGHT = 300;
const PAD = { top: 16, right: 16, bottom: 44, left: 52 };



function categoriesOf(series: ChartSeries[]): string[] {
  const seen: string[] = [];
  for (const s of series) {
    for (const p of s.points) if (!seen.includes(p.x)) seen.push(p.x);
  }
  return seen;
}

function valueAt(s: ChartSeries, cat: string): number | null {
  const p = s.points.find((pt) => pt.x === cat);
  return p && typeof p.y === 'number' ? p.y : null;
}

interface Props {
  chart: ChartSpec;
}

export function ChartView({ chart }: Props) {
  const { colors, spacing: s, radius: r } = useTheme();
  const [table, setTable] = useState(false);
  const [width, setWidth] = useState(WIDTH);
  const series = useMemo(() => chart.series ?? [], [chart.series]);
  const kind = chart.kind;
  const categories = useMemo(() => categoriesOf(series), [series]);
  // The web's validated 8-hue ramp (theme `chart`); the server refuses a ninth series.
  const colourOf = (i: number) => colors.chart[i % colors.chart.length];

  const stacked = Boolean(chart.stacked) && kind !== 'line' && kind !== 'area' && kind !== 'scatter';
  const { lo, hi } = useMemo(() => {
    let low = 0;
    let high = 0;
    if (stacked) {
      for (const cat of categories) {
        let sum = 0;
        for (const sr of series) {
          const v = valueAt(sr, cat);
          if (v !== null) sum += v;
        }
        high = Math.max(high, sum);
        low = Math.min(low, sum);
      }
    } else {
      for (const sr of series) {
        for (const p of sr.points) {
          if (typeof p.y !== 'number') continue;
          high = Math.max(high, p.y);
          low = Math.min(low, p.y);
        }
      }
    }
    return { lo: low, hi: high };
  }, [series, categories, stacked]);

  const ticks = useMemo(() => ticksFor(lo, hi), [lo, hi]);
  const yLo = ticks[0];
  const yHi = ticks[ticks.length - 1];
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const yFor = (v: number) => PAD.top + plotH - ((v - yLo) / (yHi - yLo || 1)) * plotH;
  const xFor = (i: number) =>
    categories.length <= 1 ? PAD.left + plotW / 2 : PAD.left + (i / (categories.length - 1)) * plotW;
  const band = plotW / Math.max(categories.length, 1);
  const bandCentre = (i: number) => PAD.left + i * band + band / 2;
  const labelStride = Math.max(1, Math.ceil(categories.length / 8));
  const svgHeight = (width * HEIGHT) / WIDTH;
  const zero = yFor(Math.max(yLo, 0));

  const body = (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width || WIDTH)}>
      {kind === 'pie' ? (
        <PieChart series={series} width={width} colourOf={colourOf} />
      ) : (
        <Svg width={width} height={svgHeight} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
          {ticks.map((t) => (
            <G key={`t${t}`}>
              <Line x1={PAD.left} x2={WIDTH - PAD.right} y1={yFor(t)} y2={yFor(t)} stroke={colors.border} strokeWidth={1} />
              <SvgText x={PAD.left - 8} y={yFor(t) + 3} textAnchor="end" fontSize={10} fill={colors.mutedText} fontFamily={fontFamily.regular}>
                {formatValue(t)}
              </SvgText>
            </G>
          ))}
          {yLo < 0 && yHi > 0 ? (
            <Line x1={PAD.left} x2={WIDTH - PAD.right} y1={yFor(0)} y2={yFor(0)} stroke={colors.mutedText} strokeWidth={1} />
          ) : null}
          {categories.map((cat, i) =>
            i % labelStride === 0 ? (
              <SvgText
                key={`c${cat}`}
                x={kind === 'bar' || kind === 'column' ? bandCentre(i) : xFor(i)}
                y={HEIGHT - PAD.bottom + 16}
                textAnchor="middle"
                fontSize={10}
                fill={colors.mutedText}
                fontFamily={fontFamily.regular}
              >
                {cat.length > 12 ? `${cat.slice(0, 11)}…` : cat}
              </SvgText>
            ) : null,
          )}
          {kind === 'bar' || kind === 'column'
            ? <BarMarks series={series} categories={categories} stacked={stacked} band={band} bandStart={(i) => PAD.left + i * band} yFor={yFor} valueAt={valueAt} zero={zero} colourOf={colourOf} />
            : null}
          {kind === 'line' || kind === 'area'
            ? series.map((sr, si) => (
                <LineMarks key={`l${sr.name}-${si}`} series={sr} categories={categories} area={kind === 'area'} xFor={xFor} yFor={yFor} baseline={zero} colour={colourOf(si)} />
              ))
            : null}
          {kind === 'scatter'
            ? series.map((sr, si) => (
                <G key={`s${sr.name}-${si}`}>
                  {categories.map((cat, i) => {
                    const v = valueAt(sr, cat);
                    return v === null ? null : <Circle key={`p${cat}`} cx={xFor(i)} cy={yFor(v)} r={4.5} fill={colourOf(si)} stroke={colors.surface} strokeWidth={2} />;
                  })}
                </G>
              ))
            : null}
          {chart.y_label ? (
            <SvgText x={12} y={PAD.top + plotH / 2} transform={`rotate(-90 12 ${PAD.top + plotH / 2})`} textAnchor="middle" fontSize={10} fill={colors.mutedText} fontFamily={fontFamily.regular}>
              {chart.y_label}
            </SvgText>
          ) : null}
          {chart.x_label ? (
            <SvgText x={PAD.left + plotW / 2} y={HEIGHT - 6} textAnchor="middle" fontSize={10} fill={colors.mutedText} fontFamily={fontFamily.regular}>
              {chart.x_label}
            </SvgText>
          ) : null}
        </Svg>
      )}
    </View>
  );

  return (
    <View style={[styles.figure, { borderColor: colors.border, backgroundColor: colors.surface, borderRadius: r.md }]}>
      <View style={[styles.caption, { borderBottomColor: colors.border, paddingHorizontal: s.md, paddingVertical: s.sm }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>
            {chart.title}
          </Text>
          {chart.note ? (
            <Text numberOfLines={1} style={{ color: colors.mutedText, fontSize: 12 }}>
              {chart.note}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={table ? 'Show chart' : 'Show the numbers as a table'}
          accessibilityState={{ selected: table }}
          onPress={() => setTable((v) => !v)}
          hitSlop={8}
          style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name={table ? 'stats-chart-outline' : 'grid-outline'} size={16} color={colors.mutedText} />
        </Pressable>
      </View>

      {table ? (
        <ChartTable chart={chart} categories={categories} series={series} />
      ) : (
        <View style={{ padding: s.sm }}>{body}</View>
      )}

      {series.length > 1 && !table ? (
        <View style={[styles.legend, { borderTopColor: colors.border, paddingHorizontal: s.md, paddingVertical: s.sm }]}>
          {series.map((sr, i) => (
            <View key={`lg${sr.name}-${i}`} style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: colourOf(i) }]} />
              <Text style={{ color: colors.mutedText, fontSize: 12 }}>{sr.name}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ChartTable({ chart, categories, series }: { chart: ChartSpec; categories: string[]; series: ChartSeries[] }) {
  const { colors, spacing: s } = useTheme();
  return (
    <View style={{ padding: s.md }}>
      <View style={[styles.row, { borderBottomColor: colors.border }]}>
        <Text style={[styles.cellHead, { color: colors.mutedText, flex: 1.2 }]}>{chart.x_label || ''}</Text>
        {series.map((sr, i) => (
          <Text key={`h${sr.name}-${i}`} style={[styles.cellHead, { color: colors.mutedText, textAlign: 'right' }]}>
            {sr.name}
          </Text>
        ))}
      </View>
      {categories.map((cat) => (
        <View key={`r${cat}`} style={[styles.row, { borderBottomColor: colors.border }]}>
          <Text style={[styles.cell, { color: colors.text, flex: 1.2 }]}>{cat}</Text>
          {series.map((sr, i) => {
            const v = valueAt(sr, cat);
            return (
              <Text key={`v${sr.name}-${i}`} style={[styles.cell, { color: colors.text, textAlign: 'right' }]}>
                {v === null ? '—' : formatValue(v)}
              </Text>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function LineMarks({
  series, categories, area, xFor, yFor, baseline, colour,
}: {
  series: ChartSeries; categories: string[]; area: boolean;
  xFor: (i: number) => number; yFor: (v: number) => number; baseline: number; colour: string;
}) {
  // Runs of present values: a line drawn across a gap would invent a measurement.
  const runs: { i: number; v: number }[][] = [];
  let run: { i: number; v: number }[] = [];
  categories.forEach((cat, i) => {
    const v = valueAt(series, cat);
    if (v === null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push({ i, v });
    }
  });
  if (run.length) runs.push(run);
  return (
    <G>
      {area
        ? runs.map((r, ri) => (
            <Path
              key={`a${ri}`}
              d={`M ${xFor(r[0].i)} ${baseline} ${r.map((pt) => `L ${xFor(pt.i)} ${yFor(pt.v)}`).join(' ')} L ${xFor(r[r.length - 1].i)} ${baseline} Z`}
              fill={colour}
              fillOpacity={0.16}
            />
          ))
        : null}
      {runs.map((r, ri) =>
        r.length === 1 ? (
          <Circle key={`d${ri}`} cx={xFor(r[0].i)} cy={yFor(r[0].v)} r={4} fill={colour} />
        ) : (
          <Path
            key={`l${ri}`}
            d={r.map((pt, k) => `${k ? 'L' : 'M'} ${xFor(pt.i)} ${yFor(pt.v)}`).join(' ')}
            fill="none"
            stroke={colour}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      )}
    </G>
  );
}

function BarMarks({
  series, categories, stacked, band, bandStart, yFor, valueAt: at, zero, colourOf,
}: {
  series: ChartSeries[]; categories: string[]; stacked: boolean; band: number;
  bandStart: (i: number) => number; yFor: (v: number) => number;
  valueAt: (s: ChartSeries, cat: string) => number | null; zero: number;
  colourOf: (i: number) => string;
}) {
  const GAP = 2;
  const inner = band * 0.72;
  const each = stacked ? inner : (inner - GAP * (series.length - 1)) / Math.max(series.length, 1);
  return (
    <G>
      {categories.map((cat, ci) => {
        let stackTop = zero;
        const left = bandStart(ci) + (band - inner) / 2;
        return (
          <G key={`b${cat}`}>
            {series.map((sr, si) => {
              const v = at(sr, cat);
              if (v === null) return null;
              const y = yFor(v);
              if (stacked) {
                const h = Math.abs(zero - y);
                const top = stackTop - h;
                stackTop = top;
                return <Rect key={`s${si}`} x={left} y={top} width={each} height={Math.max(0, h - GAP)} fill={colourOf(si)} rx={2} />;
              }
              return (
                <Rect
                  key={`s${si}`}
                  x={left + si * (each + GAP)}
                  y={Math.min(y, zero)}
                  width={Math.max(1, each)}
                  height={Math.max(1, Math.abs(zero - y))}
                  fill={colourOf(si)}
                  rx={2}
                />
              );
            })}
          </G>
        );
      })}
    </G>
  );
}

function PieChart({ series, width, colourOf }: { series: ChartSeries[]; width: number; colourOf: (i: number) => string }) {
  const { colors } = useTheme();
  const points = (series[0]?.points ?? []).filter((p) => typeof p.y === 'number' && p.y > 0);
  const total = points.reduce((sum, p) => sum + (p.y ?? 0), 0);
  if (!total) {
    return <Text style={{ color: colors.mutedText, fontSize: 12, textAlign: 'center', padding: spacing.md }}>No positive values to chart.</Text>;
  }
  const size = Math.min(width, 260);
  const cx = size / 2;
  const cy = size / 2;
  const rad = size / 2 - 4;
  // Each slice starts where the last one ended. A plain loop keeps the running
  // angle local to this computation rather than mutated inside a callback.
  const slices: { d: string; fill: string; key: string }[] = [];
  let start = -Math.PI / 2;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const sweep = ((p.y ?? 0) / total) * Math.PI * 2;
    const end = start + sweep;
    const x1 = cx + rad * Math.cos(start);
    const y1 = cy + rad * Math.sin(start);
    const x2 = cx + rad * Math.cos(end);
    const y2 = cy + rad * Math.sin(end);
    const large = sweep > Math.PI ? 1 : 0;
    const d = points.length === 1
      ? `M ${cx} ${cy - rad} A ${rad} ${rad} 0 1 1 ${cx - 0.01} ${cy - rad} Z`
      : `M ${cx} ${cy} L ${x1} ${y1} A ${rad} ${rad} 0 ${large} 1 ${x2} ${y2} Z`;
    slices.push({ d, fill: colourOf(i), key: `${p.x}-${i}` });
    start = end;
  }
  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={size} height={size}>
        {slices.map((s) => (
          <Path key={s.key} d={s.d} fill={s.fill} stroke={colors.surface} strokeWidth={2} />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  figure: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  caption: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.xs },
  cellHead: { fontSize: 12, fontWeight: '500', flex: 1 },
  cell: { fontSize: 12, flex: 1 },
});
