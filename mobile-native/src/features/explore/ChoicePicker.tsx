import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../components/Text';

import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { pressedOpacity, radius, spacing, typography, useTheme } from '../../theme';

export interface ChoiceOption<T extends string | number> {
  value: T;
  label: string;
  /** A line under the label: what choosing this means. */
  hint?: string;
  disabled?: boolean;
}

interface Props<T extends string | number> {
  visible: boolean;
  title: string;
  options: ChoiceOption<T>[];
  value: T | null | undefined;
  onSelect: (value: T) => void;
  onClose: () => void;
}

/**
 * One choice from a list, shown in a bottom sheet. The shared way every picker in
 * these screens opens (agent, category, visibility, requirement candidate), so a
 * choice never uses a native dropdown that looks different on each platform.
 */
export function ChoicePicker<T extends string | number>({
  visible,
  title,
  options,
  value,
  onSelect,
  onClose,
}: Props<T>) {
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <ScrollView style={styles.list} contentContainerStyle={{ gap: spacing.xs, paddingBottom: spacing.lg }}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              accessibilityRole="button"
              accessibilityLabel={option.label}
              accessibilityState={{ selected, disabled: option.disabled === true }}
              disabled={option.disabled === true}
              onPress={() => {
                onSelect(option.value);
                onClose();
              }}
              style={({ pressed }) => [
                styles.row,
                {
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.background : colors.surface,
                  borderRadius: radius.md,
                  opacity: option.disabled ? 0.5 : pressed ? pressedOpacity : 1,
                },
              ]}
            >
              <View style={styles.main}>
                <Text style={[typography.label, { color: colors.text }]}>{option.label}</Text>
                {option.hint ? (
                  <Text style={[typography.caption, { color: colors.mutedText }]}>{option.hint}</Text>
                ) : null}
              </View>
              {selected ? <Icon name="checkmark" size={20} color={colors.primary} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 420 },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  main: { flex: 1, gap: 2 },
});
