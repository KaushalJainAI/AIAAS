import { Pressable, View } from 'react-native';

import { Icon } from '../../components/Icon';
import { Text } from '../../components/Text';
import { fontFamily, fontSize, pressedOpacity, radius, spacing, useTheme } from '../../theme';

interface Props {
  label: string;
  /** The chosen option's text. Empty shows the placeholder. */
  value: string;
  placeholder: string;
  onPress: () => void;
  disabled?: boolean;
}

/** A form field whose value is picked in a `PickerSheet`. Styled like a TextField. */
export function PickerRow({ label, value, placeholder, onPress, disabled = false }: Props) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.medium }}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          borderWidth: 1,
          borderColor: colors.borderStrong,
          borderRadius: radius.md,
          backgroundColor: colors.inputBackground,
          paddingHorizontal: spacing.md,
          opacity: disabled ? 0.5 : pressed ? pressedOpacity : 1,
        })}
      >
        <Text
          numberOfLines={1}
          style={{ flex: 1, color: value ? colors.text : colors.mutedText, fontSize: fontSize.md }}
        >
          {value || placeholder}
        </Text>
        <Icon name="chevron-down" size={16} color={colors.mutedText} />
      </Pressable>
    </View>
  );
}
