import { Pressable, StyleSheet } from 'react-native';
import { Text } from '../components/Text';

import { Icon } from '../components/Icon';
import { pressedOpacity, useTheme } from '../theme';

interface Props {
  /** Sign-in or sign-up wording, e.g. "Continue with Google". */
  label: string;
  busy: boolean;
  onPress: () => void;
}

/** The web's "Continue with Google" button: outlined, the Google mark first. */
export function GoogleButton({ label, busy, onPress }: Props) {
  const { colors, fontSize, radius, typography } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          borderColor: colors.borderStrong,
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          opacity: pressed || busy ? pressedOpacity : 1,
        },
      ]}
    >
      <Icon name="logo-google" size={18} />
      <Text style={[typography.bodyStrong, { color: colors.text, fontSize: fontSize.md }]}>
        {busy ? 'Opening Google...' : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
});
