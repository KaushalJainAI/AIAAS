import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { fontFamily, fontSize, pressedOpacity, radius, spacing, useTheme } from '../theme';
import { Icon } from './Icon';

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  autoFocus?: boolean;
}

export function SearchBar({ value, onChangeText, placeholder = 'Search', onSubmit, autoFocus = false }: Props) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: colors.inputBackground, borderColor: colors.border, borderRadius: radius.md },
      ]}
    >
      <Icon name="search" size={18} color={colors.mutedText} />
      <TextInput
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedText}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        returnKeyType="search"
        style={[styles.input, { color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.regular }]}
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText('')}
          hitSlop={8}
          style={({ pressed }) => [styles.clear, { opacity: pressed ? pressedOpacity : 1 }]}
        >
          <Icon name="close-circle" size={18} color={colors.mutedText} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, paddingVertical: spacing.sm },
  clear: { minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
});
