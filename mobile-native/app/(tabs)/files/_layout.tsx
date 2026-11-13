import { Stack } from 'expo-router';

import { useTheme } from '../../../src/theme';

export default function FilesLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text }}>
      <Stack.Screen name="index" options={{ title: 'Files' }} />
    </Stack>
  );
}
