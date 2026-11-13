import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../../components/Text';

import { useTheme } from '../../theme';
import { timeAgo } from './time';
import type { InboxNotification } from './types';

interface Props {
  notification: InboxNotification;
  onPress: () => void;
}

export function NotificationRow({ notification, onPress }: Props) {
  const { colors, spacing, fontSize, radius } = useTheme();
  const unread = !notification.is_read;
  const title = notification.title || 'Notification';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Unread. ' : ''}${title}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.md,
          padding: spacing.lg,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: unread ? colors.primary : 'transparent' }]} />
      <View style={styles.body}>
        <View style={styles.topLine}>
          <Text
            style={{
              flex: 1,
              color: colors.text,
              fontSize: fontSize.md,
              fontWeight: unread ? '700' : '500',
            }}
            numberOfLines={2}
          >
            {title}
          </Text>
          <Text style={{ color: colors.mutedText, fontSize: fontSize.sm }}>{timeAgo(notification.created_at)}</Text>
        </View>
        {notification.message ? (
          <Text style={{ color: colors.mutedText, fontSize: fontSize.sm, marginTop: spacing.xs }} numberOfLines={3}>
            {notification.message}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, gap: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  body: { flex: 1, minWidth: 0 },
  topLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
});
