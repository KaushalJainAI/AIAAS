import { Stack } from 'expo-router';

import { useTheme } from '../../../../src/theme';

/** Team knowledge: the library and its drafts, the curator queue and insights, and one solution. */
export default function TeamLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text }}>
      <Stack.Screen name="index" options={{ title: 'Team knowledge' }} />
      <Stack.Screen name="[id]" options={{ title: 'Solution' }} />
      <Stack.Screen name="form" options={{ title: 'Solution' }} />
    </Stack>
  );
}
