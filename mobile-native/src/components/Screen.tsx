import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '../theme';

interface Props {
  children: ReactNode;
  /** Screens under a tab bar pass the edges without `bottom`; the tab bar already pads it. */
  edges?: Edge[];
  style?: ViewStyle;
}

export function Screen({ children, edges = ['top', 'right', 'bottom', 'left'], style }: Props) {
  const { colors, spacing } = useTheme();
  return (
    <SafeAreaView edges={edges} style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.body, { padding: spacing.lg }, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },
});
