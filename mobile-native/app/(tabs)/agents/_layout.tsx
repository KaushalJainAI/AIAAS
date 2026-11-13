import { Stack } from 'expo-router';

import { useTheme } from '../../../src/theme';

export default function AgentsLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text }}>
      <Stack.Screen name="index" options={{ title: 'Agents' }} />
      <Stack.Screen name="new" options={{ title: 'New agent' }} />
      <Stack.Screen name="[id]" options={{ title: 'Agent' }} />
      <Stack.Screen name="run/[executionId]" options={{ title: 'Run' }} />
    </Stack>
  );
}
