import { Stack } from 'expo-router';

import { useTheme } from '../../../../src/theme';

/** The saved accounts: the list, one credential, and the add / edit form. */
export default function CredentialsLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text }}>
      <Stack.Screen name="index" options={{ title: 'Credentials' }} />
      <Stack.Screen name="[id]" options={{ title: 'Credential' }} />
      <Stack.Screen name="form" options={{ title: 'Credential' }} />
    </Stack>
  );
}
