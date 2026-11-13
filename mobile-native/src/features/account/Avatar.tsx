import { Image, StyleSheet, View } from 'react-native';

import { Text } from '../../components/Text';
import { fontFamily, useTheme } from '../../theme';

/** A round picture, or the user's initials on the primary tint when there is none. */
export function Avatar({ uri, initials, size = 64 }: { uri: string | null; initials: string; size?: number }) {
  const { colors } = useTheme();
  const shape = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return <Image accessibilityLabel="Profile picture" source={{ uri }} style={[styles.image, shape]} />;
  }
  return (
    <View style={[styles.fallback, shape, { backgroundColor: colors.primaryBg }]} accessibilityLabel="Profile picture">
      <Text style={{ color: colors.primary, fontSize: size * 0.34, fontFamily: fontFamily.semibold }}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: 'transparent' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
