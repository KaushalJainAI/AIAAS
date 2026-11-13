import { Stack } from 'expo-router';

import { useTheme } from '../../../../src/theme';

/** Connections and the screens under it: one connection, a custom server, a data tool, a share. */
export default function ConnectionsLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text }}>
      <Stack.Screen name="index" options={{ title: 'Connections' }} />
      <Stack.Screen name="[id]" options={{ title: 'Connection' }} />
      <Stack.Screen name="server-form" options={{ title: 'Custom server' }} />
      <Stack.Screen name="tool-form" options={{ title: 'Tool' }} />
      <Stack.Screen name="share" options={{ title: 'Share tool' }} />
    </Stack>
  );
}
