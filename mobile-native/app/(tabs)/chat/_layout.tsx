import { Stack } from 'expo-router';

import { useTheme } from '../../../src/theme';

export default function ChatLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text }}>
      <Stack.Screen name="index" options={{ title: 'Chat' }} />
      <Stack.Screen name="[id]" options={{ title: 'Chat' }} />
      <Stack.Screen name="browser/[key]" options={{ title: 'Browser' }} />
      <Stack.Screen name="changes/[id]" options={{ title: 'Undo changes' }} />
    </Stack>
  );
}
