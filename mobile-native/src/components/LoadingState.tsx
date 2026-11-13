import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { spacing, typography, useTheme } from '../theme';

export function LoadingState({ text }: { text?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityLabel={text ?? 'Loading'}>
      <ActivityIndicator color={colors.primary} />
      {text ? <Text style={[typography.body, { color: colors.mutedText, marginTop: spacing.md }]}>{text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
});
