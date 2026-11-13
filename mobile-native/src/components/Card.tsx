import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { radius, spacing, useTheme } from '../theme';

interface Props {
  children: ReactNode;
  style?: ViewStyle;
  /** Inner padding. Defaults to `lg`. */
  padded?: boolean;
}

/** A raised surface with a hairline border, for one self-contained item. */
export function Card({ children, style, padded = true }: Props) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.md,
          padding: padded ? spacing.lg : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
});
