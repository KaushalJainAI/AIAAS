import { Text } from '../../components/Text';

import { spacing, typography, useTheme } from '../../theme';

/** A one-line outcome under a control: a success, or a refusal the person can act on. */
export function Notice({ text, tone = 'success' }: { text: string | null; tone?: 'success' | 'danger' }) {
  const { colors } = useTheme();
  if (!text) return null;
  return (
    <Text
      accessibilityRole={tone === 'danger' ? 'alert' : 'text'}
      style={[typography.caption, { color: tone === 'danger' ? colors.danger : colors.success, marginTop: spacing.sm }]}
    >
      {text}
    </Text>
  );
}
