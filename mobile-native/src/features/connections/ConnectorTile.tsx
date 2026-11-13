import { StyleSheet, View } from 'react-native';

import { Icon } from '../../components/Icon';
import { radius, useTheme } from '../../theme';
import { connectorVisual } from './icons';

/** The square icon for a connection, drawn in its theme tone on a neutral tile. */
export function ConnectorTile({ iconSlug, isSystem, size = 36 }: { iconSlug?: string; isSystem: boolean; size?: number }) {
  const { colors } = useTheme();
  const visual = connectorVisual(iconSlug, isSystem);
  return (
    <View style={[styles.tile, { width: size, height: size, backgroundColor: colors.surfaceMuted, borderRadius: radius.md }]}>
      <Icon name={visual.icon} size={Math.round(size * 0.55)} color={colors[visual.tone]} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
});
