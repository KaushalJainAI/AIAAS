import { Pressable, View } from 'react-native';

import { Text } from '../../components/Text';
import { fontSize, pressedOpacity, radius, spacing, useTheme } from '../../theme';

interface Props<T extends string> {
  options: { value: T; label: string }[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  /** Accessible group name, e.g. "Allowed methods". */
  label: string;
}

/** Several choices at once, shown as tappable chips. Each chip is 44pt tall. */
export function Chips<T extends string>({ options, selected, onToggle, label }: Props<T>) {
  const { colors } = useTheme();
  return (
    <View accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {options.map((option) => {
        const on = selected.includes(option.value);
        return (
          <Pressable
            key={option.value}
            accessibilityRole="checkbox"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: on }}
            onPress={() => onToggle(option.value)}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: 'center',
              paddingHorizontal: spacing.lg,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: on ? colors.primary : colors.border,
              backgroundColor: on ? colors.primary : colors.surface,
              opacity: pressed ? pressedOpacity : 1,
            })}
          >
            <Text style={{ color: on ? colors.primaryText : colors.text, fontSize: fontSize.md, fontWeight: '600' }}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
