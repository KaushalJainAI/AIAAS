import { Stack } from 'expo-router';

import { useTheme } from '../../../src/theme';

/** Settings and the account screens under it. Each child sets its own title. */
export default function SettingsLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text }}>
      <Stack.Screen name="index" options={{ title: 'Settings' }} />
      <Stack.Screen name="profile" options={{ title: 'Profile' }} />
      <Stack.Screen name="security" options={{ title: 'Password & email' }} />
      <Stack.Screen name="defaults" options={{ title: 'Default model & mode' }} />
      <Stack.Screen name="appearance" options={{ title: 'Appearance' }} />
      <Stack.Screen name="usage" options={{ title: 'Usage' }} />
      <Stack.Screen name="api-keys" options={{ title: 'API keys' }} />
      <Stack.Screen name="organisations" options={{ title: 'Organisations' }} />
      <Stack.Screen name="organisation" options={{ title: 'Organisation' }} />
      <Stack.Screen name="memory" options={{ title: 'Memory' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
    </Stack>
  );
}
