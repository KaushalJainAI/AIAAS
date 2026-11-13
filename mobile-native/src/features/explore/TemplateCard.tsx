import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/Text';

import { Badge } from '../../components/Badge';
import { Icon } from '../../components/Icon';
import { fontSize, pressedOpacity, radius, spacing, useTheme } from '../../theme';
import { AUTONOMY_COPY, FALLBACK_TEMPLATE_ICON, TEMPLATE_ICONS, grantedLines, isUnavailable, limitsOf } from './copy';
import type { AgentTemplate } from './types';

interface Props {
  template: AgentTemplate;
  /** How many of the caller's own agents were installed from this entry. */
  installedCount: number;
  onPress: () => void;
}

/**
 * One entry in the catalogue. Provenance is shown on the card because it decides
 * how much to read before installing: a built-in entry and a stranger's entry are
 * not the same thing, even though they install the same way.
 */
export function TemplateCard({ template, installedCount, onPress }: Props) {
  const { colors, spacing: s } = useTheme();
  const { autonomy } = limitsOf(template);
  const grants = grantedLines(template).length;
  const unavailable = isUnavailable(template);
  const installed = installedCount > 0;
  const icon = TEMPLATE_ICONS[template.icon] ?? FALLBACK_TEMPLATE_ICON;
  const provenance =
    template.source === 'curated' ? 'Built in' : template.is_mine ? 'You' : template.author ?? 'Community';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${template.name}, ${template.tagline}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: installed ? colors.primary : colors.border,
          borderRadius: radius.md,
          padding: s.lg,
          opacity: pressed ? pressedOpacity : 1,
        },
      ]}
    >
      <View style={styles.head}>
        <View style={[styles.iconTile, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <Icon name={icon} size={18} color={colors.primary} />
        </View>
        <View style={styles.titleBlock}>
          <Text numberOfLines={2} style={[styles.title, { color: colors.text }]}>
            {template.name}
          </Text>
          <Text style={[styles.meta, { color: colors.mutedText }]} numberOfLines={1}>
            {provenance} · {AUTONOMY_COPY[autonomy].label}
          </Text>
        </View>
      </View>

      <Text numberOfLines={3} style={[styles.tagline, { color: colors.mutedText }]}>
        {template.tagline}
      </Text>

      <View style={styles.badges}>
        {installed ? (
          <Badge label={installedCount === 1 ? 'Installed' : `Installed × ${installedCount}`} tone="success" />
        ) : null}
        {unavailable ? <Badge label="Not available here" tone="warning" /> : null}
        <Badge label={grants === 1 ? '1 capability' : `${grants} capabilities`} tone="neutral" />
        {template.source === 'community' && template.install_count != null ? (
          <Badge
            label={template.install_count === 1 ? '1 install' : `${template.install_count} installs`}
            tone="neutral"
          />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: { flex: 1, gap: 2 },
  title: { fontSize: fontSize.lg, fontWeight: '600' },
  meta: { fontSize: fontSize.sm },
  tagline: { fontSize: fontSize.md, lineHeight: 21 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
