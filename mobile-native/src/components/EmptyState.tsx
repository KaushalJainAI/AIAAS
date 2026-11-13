import { StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { useTheme } from '../theme';

interface Props {
  title: string;
  message?: string;
}

export function EmptyState({ title, message }: Props) {
  const { colors, spacing, fontSize } = useTheme();
  return (
    <View style={styles.wrap}>
      <Text style={{ color: colors.text, fontSize: fontSize.xl, fontWeight: '600', textAlign: 'center' }}>
        {title}
      </Text>
      {message ? (
        <Text style={{ color: colors.mutedText, fontSize: fontSize.md, marginTop: spacing.sm, textAlign: 'center' }}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
