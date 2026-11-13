import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../../../src/components/Text';
import { Stack, useRouter } from 'expo-router';

import { Button } from '../../../../src/components/Button';
import { Card } from '../../../../src/components/Card';
import { EmptyState } from '../../../../src/components/EmptyState';
import { ErrorState } from '../../../../src/components/ErrorState';
import { ErrorText } from '../../../../src/components/ErrorText';
import { Icon } from '../../../../src/components/Icon';
import { LoadingState } from '../../../../src/components/LoadingState';
import { Screen } from '../../../../src/components/Screen';
import { SearchBar } from '../../../../src/components/SearchBar';
import { SegmentedControl } from '../../../../src/components/SegmentedControl';
import { confirm } from '../../../../src/components/confirm';
import { messageOf } from '../../../../src/features/agents/format';
import { useAgents } from '../../../../src/features/agents/queries';
import { GroupHeader } from '../../../../src/features/explore/GroupHeader';
import { PACKS, SOURCE_FILTERS, packIsDown, type SourceFilter } from '../../../../src/features/explore/copy';
import { TemplateCard } from '../../../../src/features/explore/TemplateCard';
import { useInstallPack, useTemplates, useUninstallAgents } from '../../../../src/features/explore/queries';
import type { AgentTemplate, TemplateListParams } from '../../../../src/features/explore/types';
import { useRefresh } from '../../../../src/hooks/useRefresh';
import { success, warning } from '../../../../src/lib/haptics';
import { spacing, typography, useTheme } from '../../../../src/theme';

/** The API filter for each segment. `mine` includes listings the caller has withdrawn. */
function paramsFor(filter: SourceFilter): TemplateListParams {
  if (filter === 'mine') return { mine: true };
  if (filter === 'curated') return { source: 'curated' };
  if (filter === 'community') return { source: 'community' };
  return {};
}

function searchable(t: AgentTemplate): string {
  return `${t.name} ${t.tagline} ${t.description} ${t.slug} ${(t.tags ?? []).join(' ')}`.toLowerCase();
}

export default function ExploreScreen() {
  const router = useRouter();
  const { colors, spacing: s } = useTheme();
  const [filter, setFilter] = useState<SourceFilter>('all');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const templates = useTemplates(paramsFor(filter));
  const agents = useAgents();
  const installPack = useInstallPack();
  const uninstall = useUninstallAgents();

  const { refreshing, onRefresh } = useRefresh(() => Promise.all([templates.refetch(), agents.refetch()]));

  // The caller's own agents, joined to entries on `template_slug`. Installing writes that
  // field and nothing edits it afterwards, so the "installed" marks cannot drift from a name match.
  const installedBySlug = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const a of agents.data ?? []) {
      if (!a.template_slug || a.status === 'archived') continue;
      map.set(a.template_slug, [...(map.get(a.template_slug) ?? []), a.id]);
    }
    return map;
  }, [agents.data]);

  const all = useMemo(() => templates.data ?? [], [templates.data]);
  const q = query.trim().toLowerCase();

  // A query that names a pack pulls in the whole pack, so "code" shows the roster.
  const visible = useMemo(() => {
    if (!q) return all;
    const packHits = new Set(
      PACKS.filter((p) => `${p.slug} ${p.title} ${p.blurb}`.toLowerCase().includes(q)).map((p) => p.slug),
    );
    return all.filter((t) => searchable(t).includes(q) || (t.pack != null && packHits.has(t.pack)));
  }, [all, q]);

  const curated = visible.filter((t) => t.source === 'curated');
  const community = visible.filter((t) => t.source === 'community');
  const knownSlugs = new Set(PACKS.map((p) => p.slug));
  const packSections = PACKS.map((meta) => ({ meta, members: curated.filter((t) => t.pack === meta.slug) })).filter(
    (section) => section.members.length > 0,
  );
  const orphanSlugs = [
    ...new Set(curated.map((t) => t.pack).filter((p): p is string => !!p && !knownSlugs.has(p))),
  ];
  const solo = curated.filter((t) => !t.pack);
  const showCurated = filter === 'all' || filter === 'curated';
  const showCommunity = filter === 'all' || filter === 'community' || filter === 'mine';
  const installedCount = (agents.data ?? []).filter((a) => a.template_slug && a.status !== 'archived').length;

  const installCount = (t: AgentTemplate) => (installedBySlug.get(t.slug) ?? []).length;
  const openEntry = (slug: string) => router.push(`/more/explore/${slug}`);

  const runPackInstall = (pack: string) => {
    setNotice(null);
    setActionError(null);
    installPack.mutate(pack, {
      onSuccess: (result) => {
        success();
        const parts: string[] = [];
        parts.push(
          result.installed.length > 0
            ? `Installed ${result.installed.map((i) => i.name).join(', ')}.`
            : 'That pack is already installed.',
        );
        const needsSetup = result.skipped.filter((item) => item.reason === 'needs setup');
        if (needsSetup.length > 0) {
          parts.push(`${needsSetup.map((item) => item.slug).join(', ')} need setup: open them to finish.`);
        }
        setNotice(parts.join(' '));
        const engine = result.skipped.filter((item) => item.reason.startsWith('engine unavailable'));
        if (engine.length > 0) {
          setActionError(`${engine.map((item) => item.slug).join(', ')} need an engine this server has not configured.`);
        }
      },
      onError: (error) => setActionError(messageOf(error, 'Could not install that pack.')),
    });
  };

  const removeInstalled = async (agentIds: number[], label: string) => {
    const ok = await confirm({
      title: `Uninstall ${label}?`,
      message:
        agentIds.length === 1
          ? 'The agent and its schedules and settings are removed for good. Its past runs stay on Runs, marked as deleted.'
          : `${agentIds.length} agents and their schedules and settings are removed for good. Their past runs stay on Runs, marked as deleted.`,
      destructiveLabel: 'Uninstall',
    });
    if (!ok) return;
    warning();
    setNotice(null);
    setActionError(null);
    uninstall.mutate(agentIds, {
      onSuccess: () =>
        setNotice(agentIds.length === 1 ? `${label} uninstalled.` : `${agentIds.length} agents uninstalled.`),
      onError: (error) => setActionError(messageOf(error, 'Could not uninstall.')),
    });
  };

  const subtitle = templates.isPending
    ? 'Loading…'
    : q
      ? `${visible.length} of ${all.length} match "${query.trim()}"`
      : `${all.length} ${all.length === 1 ? 'entry' : 'entries'} · ${installedCount} installed`;

  const emptyTitle = q ? 'No results' : filter === 'mine' ? 'Nothing published yet' : 'Nothing to show';
  const emptyMessage = q
    ? `No entry matches "${query.trim()}". Try a different name, tag or pack.`
    : filter === 'mine'
      ? 'Open one of your agents on the web app and choose Share to list it here.'
      : filter === 'community'
        ? 'Nobody has published an agent yet. Yours would be the first.'
        : undefined;

  let body;
  if (templates.isPending) {
    body = <LoadingState text="Loading templates" />;
  } else if (templates.isError) {
    body = (
      <ErrorState message={messageOf(templates.error, 'Could not load this list.')} onRetry={() => void templates.refetch()} />
    );
  } else if (visible.length === 0) {
    body = <EmptyState title={emptyTitle} message={emptyMessage} />;
  } else {
    body = (
      <>
        {showCurated &&
          packSections.map(({ meta, members }) => {
            const installedMembers = members.filter((m) => installCount(m) > 0).length;
            const allInstalled = installedMembers === members.length;
            const down = packIsDown(members);
            const installedIds = members.flatMap((m) => installedBySlug.get(m.slug) ?? []);
            return (
              <View key={meta.slug} style={{ gap: s.md }}>
                <Card style={{ borderColor: colors.primary }}>
                  <View style={styles.packHead}>
                    <Icon name={meta.icon} size={20} color={colors.primary} />
                    <View style={styles.packTitle}>
                      <Text style={[typography.label, { color: colors.text }]}>{meta.title}</Text>
                      <Text style={[typography.caption, { color: colors.mutedText }]}>
                        {installedMembers} of {members.length} installed
                      </Text>
                    </View>
                  </View>
                  <Text style={[typography.body, styles.blurb, { color: colors.mutedText }]}>{meta.blurb}</Text>
                  {down.down ? (
                    <Text style={[typography.caption, styles.blurb, { color: colors.warning }]}>
                      Not available on this server: {down.reason}
                    </Text>
                  ) : null}
                  <View style={styles.packActions}>
                    <Button
                      title={allInstalled ? 'Installed' : 'Install pack'}
                      variant={allInstalled ? 'secondary' : 'primary'}
                      onPress={() => runPackInstall(meta.slug)}
                      disabled={allInstalled || down.down}
                      loading={installPack.isPending && installPack.variables === meta.slug}
                    />
                    {installedIds.length > 0 ? (
                      <Button
                        title="Uninstall pack"
                        variant="secondary"
                        onPress={() => void removeInstalled(installedIds, meta.title)}
                      />
                    ) : null}
                  </View>
                </Card>
                {members.map((t) => (
                  <TemplateCard key={t.slug} template={t} installedCount={installCount(t)} onPress={() => openEntry(t.slug)} />
                ))}
              </View>
            );
          })}

        {showCurated &&
          orphanSlugs.map((packSlug) => (
            <View key={packSlug} style={{ gap: s.md }}>
              <GroupHeader title={packSlug} />
              {curated
                .filter((t) => t.pack === packSlug)
                .map((t) => (
                  <TemplateCard key={t.slug} template={t} installedCount={installCount(t)} onPress={() => openEntry(t.slug)} />
                ))}
            </View>
          ))}

        {showCurated && solo.length > 0 ? (
          <View style={{ gap: s.md }}>
            <GroupHeader title="Standalone agents" footer="Installed one at a time. These belong to no pack." />
            {solo.map((t) => (
              <TemplateCard key={t.slug} template={t} installedCount={installCount(t)} onPress={() => openEntry(t.slug)} />
            ))}
          </View>
        ) : null}

        {showCommunity && community.length > 0 ? (
          <View style={{ gap: s.md }}>
            <GroupHeader
              title={filter === 'mine' ? 'Shared by you' : 'From the community'}
              footer={
                filter === 'mine'
                  ? 'Agents you have published. Installing one still makes a separate copy.'
                  : 'Agents other people published. Same install flow: read the permissions either way.'
              }
            />
            {community.map((t) => (
              <TemplateCard key={t.slug} template={t} installedCount={installCount(t)} onPress={() => openEntry(t.slug)} />
            ))}
          </View>
        ) : null}
      </>
    );
  }

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: 'Explore' }} />
      <ScrollView
        contentContainerStyle={{ gap: s.lg, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[typography.caption, { color: colors.mutedText }]}>{subtitle}</Text>
        <Text style={[typography.body, { color: colors.mutedText }]}>
          Installing adds a copy to your account. Your connections and documents never travel with it. Uninstalling
          removes the copy; its past runs stay on Runs.
        </Text>

        <SearchBar value={query} onChangeText={setQuery} placeholder="Search templates and packs" />

        <SegmentedControl
          items={SOURCE_FILTERS.map((f) => ({ key: f.key, label: f.label, count: 0 }))}
          value={filter}
          onChange={setFilter}
        />

        {notice ? (
          <Text accessibilityRole="alert" style={[typography.body, { color: colors.success }]}>
            {notice}
          </Text>
        ) : null}
        <ErrorText message={actionError} />

        {body}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  packHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  packTitle: { flex: 1, gap: 2 },
  blurb: { marginTop: spacing.sm },
  packActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
});
