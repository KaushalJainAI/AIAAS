import { Stack } from 'expo-router';

import { useTheme } from '../../../../src/theme';

/** Knowledge bases, search, and extraction schemas with their rows and review queue. */
export default function KnowledgeLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text }}>
      <Stack.Screen name="index" options={{ title: 'Knowledge' }} />
      <Stack.Screen name="[id]" options={{ title: 'Knowledge base' }} />
      <Stack.Screen name="search" options={{ title: 'Search and ask' }} />
      <Stack.Screen name="review" options={{ title: 'Review queue' }} />
      <Stack.Screen name="schema/edit" options={{ title: 'Schema' }} />
      <Stack.Screen name="schema/[id]" options={{ title: 'Schema' }} />
    </Stack>
  );
}
