import { StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { fontSize, radius, spacing, useTheme } from '../theme';
import { toneColors, type Tone } from './Badge';

/** Plain words for a run's status. "paused" is the one that needs a person. */
const LABEL: Record<string, string> = {
  pending: 'Queued',
  running: 'Running',
  paused: 'Waiting for you',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  timeout: 'Timed out',
};

const TONE: Record<string, Tone> = {
  running: 'info',
  completed: 'success',
  paused: 'warning',
  failed: 'danger',
  timeout: 'danger',
};

export function StatusPill({ status }: { status: string }) {
  const { colors } = useTheme();
  const { fg, bg } = toneColors(TONE[status] ?? 'neutral', colors);
  return (
    <View accessibilityRole="text" accessibilityLabel={LABEL[status] ?? status} style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.label, { color: fg }]}>{LABEL[status] ?? status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  label: { fontSize: fontSize.sm, fontWeight: '600' },
});
