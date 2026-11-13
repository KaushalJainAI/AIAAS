import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '../../components/Icon';
import { Text } from '../../components/Text';
import { fontSize, pressedOpacity, spacing, useTheme } from '../../theme';

export interface Crumb {
  /** `null` is the user's root ("Home" on the web). */
  id: number | null;
  name: string;
}

/** The path a folder sits in, as tappable parts. The last part is where the user is. */
export function Crumbs({ items, onPress }: { items: Crumb[]; onPress: (id: number | null) => void }) {
  const { colors } = useTheme();
  const last = items.length - 1;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityLabel="Location"
    >
      {items.map((crumb, index) => {
        const current = index === last;
        return (
          <View key={`${crumb.id ?? 'root'}-${index}`} style={styles.item}>
            {index > 0 ? <Icon name="chevron-forward" size={14} color={colors.mutedText} /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Go to ${crumb.name}`}
              accessibilityState={{ disabled: current, selected: current }}
              disabled={current}
              onPress={() => onPress(crumb.id)}
              style={({ pressed }) => [styles.chip, { opacity: pressed ? pressedOpacity : 1 }]}
            >
              <Text
                numberOfLines={1}
                style={{
                  color: current ? colors.text : colors.primary,
                  fontSize: fontSize.md,
                  fontWeight: current ? '600' : '500',
                  maxWidth: 180,
                }}
              >
                {crumb.name}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', paddingVertical: spacing.xs, gap: spacing.xs },
  item: { flexDirection: 'row', alignItems: 'center' },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xs },
});
