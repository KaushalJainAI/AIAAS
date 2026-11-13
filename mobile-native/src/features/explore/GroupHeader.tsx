import { StyleSheet, View } from 'react-native';
import { Text } from '../../components/Text';

import { spacing, typography, useTheme } from '../../theme';

interface Props {
  title: string;
  footer?: string;
}

/**
 * The heading above a group of cards that are not rows (the catalogue's cards).
 * `Section` is for grouped rows; this is the same header without the boxed group.
 */
export function GroupHeader({ title, footer }: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <Text accessibilityRole="header" style={[typography.label, { color: colors.text }]}>
        {title}
      </Text>
      {footer ? <Text style={[typography.caption, { color: colors.mutedText }]}>{footer}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, marginTop: spacing.sm },
});
