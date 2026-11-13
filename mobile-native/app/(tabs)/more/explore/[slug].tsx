import { ScrollView, RefreshControl, StyleSheet, View } from 'react-native';
import { Text } from '../../../../src/components/Text';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Badge } from '../../../../src/components/Badge';
import { Button } from '../../../../src/components/Button';
import { Card } from '../../../../src/components/Card';
import { ErrorState } from '../../../../src/components/ErrorState';
import { Icon, type IconName } from '../../../../src/components/Icon';
import { LoadingState } from '../../../../src/components/LoadingState';
import { Screen } from '../../../../src/components/Screen';
import { confirm } from '../../../../src/components/confirm';
import { messageOf } from '../../../../src/features/agents/format';
import { useAgents } from '../../../../src/features/agents/queries';
import {
  AUTONOMY_COPY,
  FILE_ACCESS_COPY,
  REQUIREMENT_NOUN,
  TEMPLATE_ICONS,
  FALLBACK_TEMPLATE_ICON,
  grantedLines,
  isUnavailable,
  limitsOf,
} from '../../../../src/features/explore/copy';
import { GroupHeader } from '../../../../src/features/explore/GroupHeader';
import { useTemplate, useUninstallAgents } from '../../../../src/features/explore/queries';
import { useRefresh } from '../../../../src/hooks/useRefresh';
import { warning } from '../../../../src/lib/haptics';
import { spacing, typography, useTheme } from '../../../../src/theme';

/** One entry's full page: the pitch, what it may do, and what it asks you for. */
export default function ExploreDetailScreen() {
  const { slug = '' } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { colors, spacing: s } = useTheme();
  const template = useTemplate(slug);
  const agents = useAgents();
  const uninstall = useUninstallAgents();
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([template.refetch(), agents.refetch()]));

  if (template.isPending) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Template' }} />
        <LoadingState text="Loading" />
      </Screen>
    );
  }

  if (template.isError || !template.data) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Template' }} />
        <ErrorState
          title="Not available"
          message={messageOf(template.error, 'This entry is not available to you. It may have been withdrawn.')}
          onRetry={() => void template.refetch()}
        />
      </Screen>
    );
  }

  const t = template.data;
  const { autonomy, fileAccess, spendCap, schedule } = limitsOf(t);
  const grants = grantedLines(t);
  const unavailable = isUnavailable(t);
  const unavailableReason = t.unavailable_reason ?? 'This template cannot run on this server.';
  const installed = (agents.data ?? []).filter((a) => a.template_slug === t.slug && a.status !== 'archived');
  const icon = TEMPLATE_ICONS[t.icon] ?? FALLBACK_TEMPLATE_ICON;
  const provenance = t.source === 'curated' ? 'Built in' : t.is_mine ? 'Shared by you' : `By ${t.author ?? 'someone'}`;

  const removeInstalled = async () => {
    const ok = await confirm({
      title: `Uninstall ${t.name}?`,
      message: `${installed.length === 1 ? installed[0].name : `${installed.length} copies`} and its schedules and settings are removed for good. Past runs stay on Runs, marked as deleted.`,
      destructiveLabel: 'Uninstall',
    });
    if (!ok) return;
    warning();
    uninstall.mutate(installed.map((a) => a.id));
  };

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: t.name }} />
      <ScrollView
        contentContainerStyle={{ gap: s.lg, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={styles.head}>
          <View style={[styles.iconTile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Icon name={icon} size={24} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>
              {t.name}
            </Text>
            <Text style={[typography.caption, { color: colors.mutedText }]}>
              {provenance}
              {t.source === 'community' && t.install_count != null
                ? ` · ${t.install_count === 0 ? 'No installs yet' : `${t.install_count} ${t.install_count === 1 ? 'install' : 'installs'}`}`
                : ''}
              {t.is_listed === false ? ' · withdrawn' : ''}
            </Text>
          </View>
        </View>

        <Text style={[typography.body, { color: colors.text }]}>{t.tagline}</Text>
        {t.description ? <Text style={[typography.body, { color: colors.mutedText }]}>{t.description}</Text> : null}

        <View style={styles.badges}>
          <Badge label={AUTONOMY_COPY[autonomy].label} tone="primary" />
          {installed.length > 0 ? (
            <Badge label={installed.length === 1 ? 'Installed' : `Installed × ${installed.length}`} tone="success" />
          ) : null}
          {unavailable ? <Badge label="Not available here" tone="warning" /> : null}
        </View>

        {unavailable ? (
          <Card>
            <Text style={[typography.body, { color: colors.warning }]}>{unavailableReason}</Text>
          </Card>
        ) : null}

        <GroupHeader title="What it will be able to do" footer="Every line is enforced, not described. It is the permission envelope you are agreeing to." />
        <Card>
          {grants.length === 0 ? (
            <Text style={[typography.body, { color: colors.mutedText }]}>
              Nothing beyond answering you. It has no tools at all.
            </Text>
          ) : (
            <View style={{ gap: s.sm }}>
              {grants.map((line) => (
                <View key={line} style={styles.line}>
                  <Icon name="checkmark" size={16} color={colors.primary} />
                  <Text style={[typography.body, styles.lineText, { color: colors.text }]}>{line}</Text>
                </View>
              ))}
            </View>
          )}
        </Card>

        <GroupHeader title="Limits" />
        <Card>
          <View style={{ gap: s.sm }}>
            <Limit icon="shield-checkmark-outline" text={AUTONOMY_COPY[autonomy].hint} />
            <Limit icon="globe-outline" text="The sandbox it runs code in cannot reach the network." />
            <Limit icon="folder-outline" text={FILE_ACCESS_COPY[fileAccess].hint} />
            <Limit icon="cash-outline" text={`Spends at most ₹${spendCap} a month.`} />
            {schedule ? (
              <Limit
                icon="time-outline"
                text={`Runs on its own schedule (${schedule}) in your timezone, so it may run with nobody watching.`}
              />
            ) : null}
          </View>
        </Card>

        {t.requirements.length > 0 ? (
          <>
            <GroupHeader
              title="What it should use"
              footer="Nothing of the author's comes with it: no credentials, no documents. You point your copy at your own things."
            />
            <Card>
              <View style={{ gap: s.md }}>
                {t.requirements.map((req) => (
                  <View key={req.key} style={{ gap: 2 }}>
                    <Text style={[typography.label, { color: colors.text }]}>
                      {req.label}
                      {req.optional ? ' · optional' : ''}
                    </Text>
                    <Text style={[typography.caption, { color: colors.mutedText }]}>
                      {REQUIREMENT_NOUN[req.type] ?? req.type}. {req.why}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
          </>
        ) : null}

        <View style={{ gap: s.sm }}>
          {installed.length > 0 ? (
            <Button
              title={installed.length === 1 ? `Open ${installed[0].name}` : 'Open first copy'}
              onPress={() => router.push(`/agents/${installed[0].id}`)}
            />
          ) : null}
          {!unavailable ? (
            <Button
              title={t.source === 'curated' ? 'Use this template' : 'Use this agent'}
              variant={installed.length > 0 ? 'secondary' : 'primary'}
              onPress={() => router.push(`/more/explore/install/${t.slug}`)}
            />
          ) : null}
          {installed.length > 0 ? (
            <Button
              title={installed.length === 1 ? 'Uninstall' : 'Uninstall all copies'}
              variant="secondary"
              onPress={() => void removeInstalled()}
              loading={uninstall.isPending}
            />
          ) : null}
        </View>

        <Text style={[typography.caption, { color: colors.mutedText }]}>
          Installing creates your own copy. You can change anything afterwards, and uninstalling removes the copy
          again.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Limit({ icon, text }: { icon: IconName; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.line}>
      <Icon name={icon} size={16} color={colors.mutedText} />
      <Text style={[typography.body, styles.lineText, { color: colors.text }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconTile: { width: 48, height: 48, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  lineText: { flex: 1 },
});
