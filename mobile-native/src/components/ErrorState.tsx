import { StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { spacing, typography, useTheme } from '../theme';
import { Button } from './Button';
import { Icon } from './Icon';

interface Props {
  message: string;
  title?: string;
  onRetry?: () => void;
}

export function ErrorState({ message, title = 'Something went wrong', onRetry }: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <Icon name="alert-circle-outline" size={40} color={colors.danger} />
      <Text style={[typography.heading, styles.center, { color: colors.text, marginTop: spacing.md }]}>{title}</Text>
      <Text style={[typography.body, styles.center, { color: colors.mutedText, marginTop: spacing.sm }]}>{message}</Text>
      {onRetry ? (
        <View style={styles.action}>
          <Button title="Retry" onPress={onRetry} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  center: { textAlign: 'center' },
  action: { alignSelf: 'stretch', marginTop: spacing.xl },
});
