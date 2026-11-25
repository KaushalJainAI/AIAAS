/**
 * "Undo changes…" under a chat answer that changed something. Opens the undo
 * screen for that change set. Mirrors the web's link in `ChatMessageItem`.
 */
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { Text } from '../../components/Text';
import { pressedOpacity, typography, useTheme } from '../../theme';

export function UndoChangesLink({ setId }: { setId: number }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Undo changes"
      onPress={() => router.push({ pathname: '/chat/changes/[id]', params: { id: String(setId) } })}
      style={({ pressed }) => [styles.link, pressed && { opacity: pressedOpacity }]}
    >
      <Text style={[typography.label, { color: colors.primary }]}>Undo changes…</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 44 },
});
