import { Text } from '../../components/Text';
import { fontSize, spacing, useTheme } from '../../theme';

export type NoticeTone = 'success' | 'warning' | 'danger' | 'info';

/** A sentence that reports what happened on this screen. Announced to screen readers. */
export function Notice({ message, tone = 'info' }: { message?: string | null; tone?: NoticeTone }) {
  const { colors } = useTheme();
  if (!message) return null;
  const color = colors[tone];
  return (
    <Text
      accessibilityRole="alert"
      style={{ color, fontSize: fontSize.md, lineHeight: 21, marginTop: spacing.xs }}
    >
      {message}
    </Text>
  );
}
