import { Stack } from 'expo-router';

import { useTheme } from '../../../src/theme';

export default function InboxLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text }}>
      <Stack.Screen name="index" options={{ title: 'Inbox' }} />
      <Stack.Screen name="[id]" options={{ title: 'Request' }} />
    </Stack>
  );
}
