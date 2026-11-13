import { Children, Fragment, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { radius, spacing, typography, useTheme } from '../theme';

interface Props {
  title?: string;
  footer?: string;
  children: ReactNode;
}

/** A grouped list: an optional header, rows separated by hairlines, an optional footer. */
export function Section({ title, footer, children }: Props) {
  const { colors } = useTheme();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.wrap}>
      {title ? (
        <Text accessibilityRole="header" style={[typography.caption, styles.header, { color: colors.mutedText }]}>
          {title.toUpperCase()}
        </Text>
      ) : null}
      <View
        style={[
          styles.group,
          { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md },
        ]}
      >
        {rows.map((row, index) => (
          <Fragment key={index}>
            {index > 0 ? <View style={[styles.divider, { backgroundColor: colors.border }]} /> : null}
            {row}
          </Fragment>
        ))}
      </View>
      {footer ? <Text style={[typography.caption, styles.footer, { color: colors.mutedText }]}>{footer}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  header: { marginLeft: spacing.xs, fontWeight: '600' },
  group: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: spacing.lg },
  footer: { marginHorizontal: spacing.xs },
});
