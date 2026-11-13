import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../../components/Text';

import { useTheme } from '../../theme';
import { isFailure, requestTypeLabel } from './request';
import { timeAgo } from './time';
import type { HITLRequest } from './types';

interface Props {
  request: HITLRequest;
  onPress: () => void;
}

export function RequestRow({ request, onPress }: Props) {
  const { colors, spacing, fontSize, radius } = useTheme();
  const failed = isFailure(request.request_type);
  const label = requestTypeLabel(request.request_type);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${request.title}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.md,
          padding: spacing.lg,
          gap: spacing.xs,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={styles.topLine}>
        <Text style={{ color: failed ? colors.danger : colors.primary, fontSize: fontSize.sm, fontWeight: '600' }}>
          {label}
        </Text>
        <Text style={{ color: colors.mutedText, fontSize: fontSize.sm }}>{timeAgo(request.created_at)}</Text>
      </View>
      <Text style={{ color: colors.text, fontSize: fontSize.lg, fontWeight: '600' }} numberOfLines={2}>
        {request.title}
      </Text>
      {request.workflow_name ? (
        <Text style={{ color: colors.mutedText, fontSize: fontSize.sm }} numberOfLines={1}>
          {request.workflow_name}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth },
  topLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
