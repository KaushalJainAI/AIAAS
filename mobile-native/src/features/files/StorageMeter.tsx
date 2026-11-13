import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { fontSize, spacing, useTheme } from '../../theme';
import { formatSize } from './display';
import { useStorage } from './queries';

/** Where the bar turns amber, then red: the web's thresholds. */
const WARN_AT = 80;
const FULL_AT = 95;

/**
 * How much of the account's storage is used. Draws nothing while loading, on an
 * error, or when the deployment sets no quota. Mirrors `components/explorer/StorageMeter.tsx`.
 */
export function StorageMeter({ onOpenTrash }: { onOpenTrash: () => void }) {
  const { colors } = useTheme();
  const { data } = useStorage();
  if (!data || !data.limit_bytes) return null;

  const percent = Math.min(100, data.percent ?? 0);
  const trash = data.breakdown.trash;
  const tone = percent >= FULL_AT ? colors.danger : percent >= WARN_AT ? colors.warning : colors.primary;

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={{ color: colors.text, fontSize: fontSize.md, fontWeight: '600' }}>Storage</Text>
        <Text style={{ color: colors.mutedText, fontSize: fontSize.sm }}>
          {`${formatSize(data.used_bytes)} of ${formatSize(data.limit_bytes)}`}
        </Text>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Storage used"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(percent) }}
        style={[styles.track, { backgroundColor: colors.border }]}
      >
        <View style={[styles.fill, { width: `${Math.max(percent, 1)}%`, backgroundColor: tone }]} />
      </View>
      {percent >= WARN_AT ? (
        <Text style={{ color: percent >= FULL_AT ? colors.danger : colors.mutedText, fontSize: fontSize.sm, marginTop: spacing.xs }}>
          {percent >= FULL_AT ? 'Almost full. New files may be refused.' : 'Getting full.'}
        </Text>
      ) : null}
      {trash > 0 ? (
        <Pressable accessibilityRole="button" onPress={onOpenTrash} style={styles.link}>
          <Text style={{ color: colors.primary, fontSize: fontSize.sm }}>{`Trash holds ${formatSize(trash)}`}</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: spacing.xs },
  fill: { height: '100%', borderRadius: 3 },
  link: { minHeight: 44, justifyContent: 'center' },
});
