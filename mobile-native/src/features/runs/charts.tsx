/**
 * The two charts the Insights view draws, both in react-native-svg so they look
 * the same on Android and iOS. Each one measures the width it is given and draws
 * to that, so nothing is hard-coded to a phone size.
 */
import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { G, Rect } from 'react-native-svg';

import { Text } from '../../components/Text';
import { spacing, typography, useTheme } from '../../theme';

function useMeasuredWidth(): [number, (event: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  return [width, (event) => setWidth(Math.round(event.nativeEvent.layout.width))];
}

interface ColumnChartProps {
  /** One column per entry, drawn from zero. */
  values: number[];
  /** Optional overlay drawn inside each column (for example successes within runs). */
  overlay?: number[];
  /** Labels at the two ends of the axis. */
  firstLabel?: string;
  lastLabel?: string;
  height?: number;
}

/** Vertical bars for a series over time. */
export function ColumnChart({ values, overlay, firstLabel, lastLabel, height = 120 }: ColumnChartProps) {
  const { colors } = useTheme();
  const [width, onLayout] = useMeasuredWidth();
  const count = values.length;
  const max = Math.max(1, ...values);
  const gap = count > 20 ? 2 : 4;
  const barWidth = count > 0 ? Math.max(2, (width - gap * (count - 1)) / count) : 0;
  const usable = height - 4;

  return (
    <View style={styles.chart}>
      <View onLayout={onLayout} style={{ height }}>
        {width > 0 && count > 0 ? (
          <Svg width={width} height={height}>
            {values.map((value, i) => {
              const barHeight = (value / max) * usable;
              const x = i * (barWidth + gap);
              const overHeight = Math.min(barHeight, ((overlay?.[i] ?? 0) / max) * usable);
              return (
                <G key={i}>
                  <Rect x={x} y={height - barHeight} width={barWidth} height={barHeight} rx={2} fill={colors.primary} />
                  {overHeight > 0 ? (
                    <Rect x={x} y={height - overHeight} width={barWidth} height={overHeight} rx={2} fill={colors.success} />
                  ) : null}
                </G>
              );
            })}
          </Svg>
        ) : null}
      </View>
      {firstLabel || lastLabel ? (
        <View style={styles.axis}>
          <Text style={[typography.caption, { color: colors.mutedText }]}>{firstLabel ?? ''}</Text>
          <Text style={[typography.caption, { color: colors.mutedText }]}>{lastLabel ?? ''}</Text>
        </View>
      ) : null}
    </View>
  );
}

export interface BarRow {
  label: string;
  value: number;
  /** The figure printed at the right of the row. */
  display: string;
}

/** Horizontal bars, one per row, scaled to the largest value. */
export function HorizontalBars({ rows, tone = 'primary' }: { rows: BarRow[]; tone?: 'primary' | 'danger' }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <View style={styles.bars}>
      {rows.map((row, i) => (
        <BarLine key={`${row.label}-${i}`} row={row} ratio={row.value / max} tone={tone} />
      ))}
    </View>
  );
}

function BarLine({ row, ratio, tone }: { row: BarRow; ratio: number; tone: 'primary' | 'danger' }) {
  const { colors } = useTheme();
  const [width, onLayout] = useMeasuredWidth();
  const fill = tone === 'danger' ? colors.danger : colors.primary;
  const filled = row.value > 0 ? Math.max(2, width * Math.min(1, ratio)) : 0;
  return (
    <View style={styles.barLine}>
      <View style={styles.barText}>
        <Text style={[typography.caption, styles.barLabel, { color: colors.text }]} numberOfLines={1}>
          {row.label}
        </Text>
        <Text style={[typography.caption, { color: colors.mutedText }]}>{row.display}</Text>
      </View>
      <View onLayout={onLayout} style={styles.track}>
        {width > 0 ? (
          <Svg width={width} height={10}>
            <Rect x={0} y={0} width={width} height={10} rx={5} fill={colors.border} />
            {filled > 0 ? <Rect x={0} y={0} width={filled} height={10} rx={5} fill={fill} /> : null}
          </Svg>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { gap: spacing.xs },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  bars: { gap: spacing.md },
  barLine: { gap: spacing.xs },
  barText: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  barLabel: { flex: 1 },
  track: { height: 10 },
});
