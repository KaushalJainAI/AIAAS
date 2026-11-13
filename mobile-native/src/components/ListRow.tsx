import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { pressedOpacity, spacing, typography, useTheme } from '../theme';
import { Icon, type IconName } from './Icon';

interface Props {
  title: string;
  subtitle?: string;
  /** Leading icon. */
  icon?: IconName;
  /** Text (or any node) shown at the right, before the chevron. */
  detail?: ReactNode;
  /** Shows a chevron. Defaults to true when the row is pressable. */
  chevron?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Draws the title and icon in the danger colour, e.g. for "Delete". */
  destructive?: boolean;
  disabled?: boolean;
}

/** One row of a grouped list. Every row is at least 44pt tall. */
export function ListRow({
  title,
  subtitle,
  icon,
  detail,
  chevron,
  onPress,
  onLongPress,
  destructive = false,
  disabled = false,
}: Props) {
  const { colors } = useTheme();
  const pressable = Boolean(onPress || onLongPress);
  const showChevron = chevron ?? pressable;
  const hasDetail = detail !== undefined && detail !== null && detail !== false && detail !== '';

  const body = (
    <>
      {icon ? (
        <View style={styles.leading}>
          <Icon name={icon} size={22} color={destructive ? colors.danger : colors.primary} />
        </View>
      ) : null}
      <View style={styles.main}>
        <Text style={[typography.label, { color: destructive ? colors.danger : colors.text }]} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[typography.caption, { color: colors.mutedText }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {hasDetail ? (
        typeof detail === 'string' ? (
          <Text style={[typography.caption, styles.detailText, { color: colors.mutedText }]} numberOfLines={1}>
            {detail}
          </Text>
        ) : (
          <View style={styles.detailNode}>{detail}</View>
        )
      ) : null}
      {showChevron ? <Icon name="chevron-forward" size={18} color={colors.mutedText} /> : null}
    </>
  );

  if (!pressable) {
    return <View style={[styles.row, { opacity: disabled ? 0.5 : 1 }]}>{body}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, { opacity: disabled ? 0.5 : pressed ? pressedOpacity : 1 }]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  leading: { width: 28, alignItems: 'center' },
  main: { flex: 1, gap: 2 },
  detailText: { maxWidth: '40%' },
  detailNode: { alignItems: 'flex-end' },
});
