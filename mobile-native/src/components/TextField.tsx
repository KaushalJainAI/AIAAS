import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Text } from './Text';

import { fontFamily, useTheme } from '../theme';
import { ErrorText } from './ErrorText';

type Props = TextInputProps & {
  label: string;
  error?: string | null;
};

export function TextField({ label, error, style, ...input }: Props) {
  const { colors, spacing, fontSize, radius } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ color: colors.text, fontSize: fontSize.md, fontWeight: '500' }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.mutedText}
        {...input}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.inputBackground,
            borderColor: error ? colors.danger : colors.borderStrong,
            borderRadius: radius.md,
            fontSize: fontSize.md,
            fontFamily: fontFamily.regular,
          },
          style,
        ]}
      />
      <ErrorText message={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 12 },
});
