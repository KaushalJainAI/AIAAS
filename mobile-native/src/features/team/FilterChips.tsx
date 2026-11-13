import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '../../components/Text';
import { pressedOpacity, radius, spacing, typography, useTheme } from '../../theme';

export interface ChipItem<K extends string> {
  key: K;
  label: string;
  /** Shown after the label when above zero. */
  count?: number;
}

/**
 * Filter pills in one row that scrolls sideways. Each pill is 44pt tall. The
 * selected pill takes the primary colour, as the web's selected filters do.
 */
export function FilterChips<K extends string>({
  items,
  value,
  onChange,
}: {
  items: ChipItem<K>[];
  value: K;
  onChange: (key: K) => void;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {items.map((item) => {
        const on = item.key === value;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={item.count ? `${item.label}, ${item.count}` : item.label}
            onPress={() => onChange(item.key)}
            style={({ pressed }) => [
              styles.chip,
              {
                borderColor: on ? colors.primary : colors.border,
                backgroundColor: on ? colors.primary : colors.surface,
                opacity: pressed ? pressedOpacity : 1,
              },
            ]}
          >
            <View style={styles.inner}>
              <Text style={[typography.label, { color: on ? colors.primaryText : colors.text }]}>{item.label}</Text>
              {item.count ? (
                <Text style={[typography.caption, { color: on ? colors.primaryText : colors.danger }]}>{item.count}</Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  inner: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
