import { Text } from './Text';

import { useTheme } from '../theme';

export function ErrorText({ message }: { message?: string | null }) {
  const { colors, spacing, fontSize } = useTheme();
  if (!message) return null;
  return (
    <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: fontSize.md, marginTop: spacing.xs }}>
      {message}
    </Text>
  );
}
