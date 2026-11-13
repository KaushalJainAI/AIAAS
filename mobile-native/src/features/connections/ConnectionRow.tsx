import { Pressable, View } from 'react-native';

import { Text } from '../../components/Text';
import { fontFamily, fontSize, pressedOpacity, spacing, typography, useTheme } from '../../theme';
import { ThemedSwitch } from '../settings/ThemedSwitch';
import { ConnectorTile } from './ConnectorTile';
import { isPlatformOff, STATUS_LABEL, statusIsWorking, type ConnectionStatus } from './status';
import type { MCPServer } from './types';

interface Props {
  server: MCPServer;
  status: ConnectionStatus;
  busy: boolean;
  onPress: () => void;
  onToggle: (enabled: boolean) => void;
}

/**
 * One connection in a list: its icon, name, tagline, status, and the per-user
 * switch. A platform-off connection keeps its switch inert, because the user
 * cannot turn it on.
 */
export function ConnectionRow({ server, status, busy, onPress, onToggle }: Props) {
  const { colors } = useTheme();
  const isOn = server.effective_enabled;
  const platformOff = isPlatformOff(status);
  const working = statusIsWorking(status);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${server.label}, ${STATUS_LABEL[status]}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        minHeight: 56,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        opacity: pressed ? pressedOpacity : isOn ? 1 : 0.7,
      })}
    >
      <ConnectorTile iconSlug={server.icon_slug} isSystem={server.is_system} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.semibold }} numberOfLines={1}>
          {server.label}
        </Text>
        {server.tagline ? (
          <Text style={[typography.caption, { color: colors.mutedText }]} numberOfLines={2}>
            {server.tagline}
          </Text>
        ) : null}
        <Text style={[typography.caption, { color: working ? colors.success : colors.mutedText }]}>
          {isOn || platformOff ? STATUS_LABEL[status] : STATUS_LABEL.off}
        </Text>
      </View>
      <ThemedSwitch
        label={`${isOn ? 'Turn off' : 'Turn on'} ${server.label}`}
        value={isOn}
        disabled={busy || platformOff}
        onChange={onToggle}
      />
    </Pressable>
  );
}
