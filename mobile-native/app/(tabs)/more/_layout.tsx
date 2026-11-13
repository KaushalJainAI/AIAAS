import { Stack } from 'expo-router';

import { useTheme } from '../../../src/theme';

/** Every area reached from More. Each child screen sets its own title. */
export default function MoreLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text }}>
      <Stack.Screen name="index" options={{ title: 'More' }} />
    </Stack>
  );
}
