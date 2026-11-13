import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { Text } from './Text';

import { useTheme } from '../theme';

interface Props {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  loading?: boolean;
  disabled?: boolean;
}

export function Button({ title, onPress, variant = 'primary', loading = false, disabled = false }: Props) {
  const { colors, spacing, fontSize, radius } = useTheme();
  const primary = variant === 'primary';
  const inactive = disabled || loading;
  const labelColor = primary ? colors.primaryText : colors.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          borderRadius: radius.md,
          paddingVertical: spacing.md,
          backgroundColor: primary ? colors.primary : colors.surface,
          borderColor: colors.border,
          borderWidth: primary ? 0 : StyleSheet.hairlineWidth,
        },
        pressed && !inactive && styles.pressed,
        inactive && styles.inactive,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <Text style={{ color: labelColor, fontSize: fontSize.md, fontWeight: '500' }}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  pressed: { opacity: 0.8 },
  inactive: { opacity: 0.5 },
});
