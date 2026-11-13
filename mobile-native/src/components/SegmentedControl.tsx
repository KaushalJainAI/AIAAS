import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { fontSize, pressedOpacity, radius, spacing, useTheme } from '../theme';

export interface SegmentItem<K extends string> {
  key: K;
  label: string;
  count: number;
}

interface Props<K extends string> {
  items: SegmentItem<K>[];
  value: K;
  onChange: (key: K) => void;
}

/** Two or three choices in one row. Moved here from features/inbox; that path re-exports it. */
export function SegmentedControl<K extends string>({ items, value, onChange }: Props<K>) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.track,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.md,
          padding: spacing.xs,
          marginBottom: spacing.lg,
        },
      ]}
    >
      {items.map((item) => {
        const on = item.key === value;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={item.count > 0 ? `${item.label}, ${item.count}` : item.label}
            onPress={() => onChange(item.key)}
            style={({ pressed }) => [
              styles.segment,
              {
                borderRadius: radius.sm,
                backgroundColor: on ? colors.primary : 'transparent',
                opacity: pressed ? pressedOpacity : 1,
              },
            ]}
          >
            <Text style={{ color: on ? colors.primaryText : colors.text, fontSize: fontSize.md, fontWeight: '600' }}>
              {item.label}
            </Text>
            {item.count > 0 ? (
              <View style={[styles.badge, { backgroundColor: on ? colors.primaryText : colors.primary }]}>
                <Text style={{ color: on ? colors.primary : colors.primaryText, fontSize: fontSize.sm, fontWeight: '700' }}>
                  {item.count}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth },
  segment: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  badge: { minWidth: 22, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 11, alignItems: 'center' },
});
