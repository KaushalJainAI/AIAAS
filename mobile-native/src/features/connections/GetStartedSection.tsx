import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '../../components/Icon';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { pressedOpacity, radius, spacing, typography, useTheme } from '../../theme';
import type { SetupGuide } from './types';

interface Props {
  guide: SetupGuide;
}

/**
 * The Get started panel: what a connection needs, who must approve it, what it
 * costs, and the exact steps. Shown before connecting. Only parts with content
 * are drawn. Presentational only; it makes no API calls.
 */
export function GetStartedSection({ guide }: Props) {
  const { colors } = useTheme();
  const costAndTime = [guide.cost, guide.time].map((part) => part.trim()).filter(Boolean).join(' · ');

  return (
    <Section title="Get started">
      {guide.you_need.length > 0 ? (
        <View style={styles.block}>
          <Text style={[typography.label, { color: colors.text }]}>You need</Text>
          {guide.you_need.map((item) => (
            <Bullet key={item} text={item} />
          ))}
        </View>
      ) : null}

      {guide.admin_needed ? (
        <View style={[styles.block, styles.note, { backgroundColor: colors.warningBg }]}>
          <Text style={[typography.label, { color: colors.warning }]}>Admin approval</Text>
          <Text style={[typography.body, { color: colors.text }]}>{guide.admin_needed}</Text>
        </View>
      ) : null}

      {costAndTime ? (
        <View style={styles.block}>
          <Text style={[typography.caption, { color: colors.mutedText }]}>{costAndTime}</Text>
        </View>
      ) : null}

      <View style={styles.block}>
        <Text style={[typography.label, { color: colors.text }]}>Steps</Text>
        {guide.steps.map((step, index) => {
          const url = step.url;
          return (
            <View key={index} style={styles.step}>
              <View style={[styles.number, { backgroundColor: colors.primaryBg }]}>
                <Text style={[typography.caption, { color: colors.primary }]}>{index + 1}</Text>
              </View>
              <View style={styles.stepBody}>
                <Text style={[typography.body, { color: colors.text }]}>{step.text}</Text>
                {url ? (
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={`Open link for step ${index + 1}`}
                    onPress={() => {
                      void Linking.openURL(url).catch(() => undefined);
                    }}
                    style={({ pressed }) => [styles.link, { opacity: pressed ? pressedOpacity : 1 }]}
                  >
                    <Icon name="open-outline" size={16} color={colors.primary} />
                    <Text style={[typography.label, { color: colors.primary }]}>Open link</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>

      {guide.limits.length > 0 ? (
        <View style={styles.block}>
          <Text style={[typography.label, { color: colors.text }]}>Good to know</Text>
          {guide.limits.map((item) => (
            <Bullet key={item} text={item} />
          ))}
        </View>
      ) : null}
    </Section>
  );
}

function Bullet({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.bullet}>
      <Text style={[typography.body, { color: colors.mutedText }]}>•</Text>
      <Text style={[typography.body, styles.bulletText, { color: colors.text }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { padding: spacing.lg, gap: spacing.sm },
  note: { marginHorizontal: spacing.md, marginVertical: spacing.sm, borderRadius: radius.sm, gap: spacing.xs },
  bullet: { flexDirection: 'row', gap: spacing.sm, paddingLeft: spacing.xs },
  bulletText: { flex: 1 },
  step: { flexDirection: 'row', gap: spacing.md },
  number: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepBody: { flex: 1, gap: spacing.xs },
  link: {
    minHeight: 44,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
