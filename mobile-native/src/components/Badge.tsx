import { StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { fontSize, radius, spacing, useTheme, type ThemeColors } from '../theme';

export type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface Props {
  /** A number, shown as-is (99+ past that). Use `label` for words. */
  count?: number;
  label?: string;
  tone?: Tone;
  /** Accessible name when the visible text is only a number. */
  accessibilityLabel?: string;
}

/** The strong colour and its tint for a tone. */
export function toneColors(tone: Tone, colors: ThemeColors): { fg: string; bg: string } {
  switch (tone) {
    case 'success':
      return { fg: colors.success, bg: colors.successBg };
    case 'warning':
      return { fg: colors.warning, bg: colors.warningBg };
    case 'danger':
      return { fg: colors.danger, bg: colors.dangerBg };
    case 'info':
      return { fg: colors.info, bg: colors.infoBg };
    case 'neutral':
      return { fg: colors.mutedText, bg: colors.border };
    case 'primary':
    default:
      return { fg: colors.primaryText, bg: colors.primary };
  }
}

export function Badge({ count, label, tone = 'primary', accessibilityLabel }: Props) {
  const { colors } = useTheme();
  const { fg, bg } = toneColors(tone, colors);
  const isWord = label !== undefined;
  const text = isWord ? label : count !== undefined ? (count > 99 ? '99+' : String(count)) : '';
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? text}
      style={[isWord ? styles.word : styles.count, { backgroundColor: bg }]}
    >
      <Text style={{ color: fg, fontSize: fontSize.sm, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

const base = {
  alignItems: 'center',
  justifyContent: 'center',
  paddingHorizontal: spacing.sm,
} as const;

const styles = StyleSheet.create({
  count: { ...base, minWidth: 22, height: 22, borderRadius: radius.lg },
  word: { ...base, alignSelf: 'flex-start', borderRadius: radius.sm, paddingVertical: spacing.xs },
});
