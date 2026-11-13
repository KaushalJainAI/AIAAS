import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { SearchBar } from '../../components/SearchBar';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Text } from '../../components/Text';
import { useRefresh } from '../../hooks/useRefresh';
import { fontSize, spacing, typography, useTheme } from '../../theme';
import { healthView, maskedKey, type HealthTone } from './health';
import { credentialIcon } from './icons';
import { useCredentialTypes, useCredentials } from './queries';
import type { Credential } from './types';

type Filter = 'all' | 'verified' | 'unverified';

/** Group by provider display name, A–Z. Newest first inside a group, as on the web. */
function groupByType(rows: Credential[]): { type: string; items: Credential[] }[] {
  const groups = new Map<string, Credential[]>();
  for (const c of rows) {
    const key = c.credential_type_display || 'Other';
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, items]) => ({ type, items }));
}

function toneColor(tone: HealthTone, colors: ReturnType<typeof useTheme>['colors']): string {
  switch (tone) {
    case 'success':
      return colors.success;
    case 'warning':
      return colors.warning;
    case 'danger':
      return colors.danger;
    default:
      return colors.mutedText;
  }
}

/** The Credentials page: every saved account, grouped by provider, with the verify state front and centre. */
export function CredentialsScreen() {
  const { colors } = useTheme();
  const creds = useCredentials();
  const types = useCredentialTypes();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const all = useMemo(() => creds.data ?? [], [creds.data]);
  const needle = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      all.filter(
        (c) => c.name.toLowerCase().includes(needle) || c.credential_type_display.toLowerCase().includes(needle),
      ),
    [all, needle],
  );
  const verifiedCount = filtered.filter((c) => c.is_verified).length;
  const unverifiedCount = filtered.length - verifiedCount;
  const visible = filtered.filter((c) =>
    filter === 'all' ? true : filter === 'verified' ? c.is_verified : !c.is_verified,
  );
  const groups = groupByType(visible);
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([creds.refetch(), types.refetch()]));

  if (creds.isPending) return <LoadingState text="Loading credentials" />;
  if (creds.isError) {
    return (
      <ErrorState
        message="Failed to load credentials. Check your connection and try again."
        onRetry={() => void creds.refetch()}
      />
    );
  }

  const totalUnverified = all.filter((c) => !c.is_verified).length;

  return (
    <Screen edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={{ gap: spacing.xs }}>
          <Text style={typography.heading} accessibilityRole="header">Credentials</Text>
          <Text style={[typography.body, { color: colors.mutedText }]}>Manage your external service connections</Text>
        </View>

        <Button title="Add Credential" onPress={() => router.push('/more/credentials/form')} />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' }}>
          <Badge label={`${verifiedCount} verified`} tone="success" />
          {unverifiedCount > 0 ? <Badge label={`${unverifiedCount} need verification`} tone="warning" /> : null}
        </View>

        <SegmentedControl<Filter>
          value={filter}
          onChange={setFilter}
          items={[
            { key: 'all', label: 'All', count: 0 },
            { key: 'verified', label: 'Verified', count: 0 },
            { key: 'unverified', label: 'Needs verification', count: 0 },
          ]}
        />

        <SearchBar value={search} onChangeText={setSearch} placeholder="Search credentials..." />

        {totalUnverified > 0 && filter === 'all' ? (
          <Card style={{ borderColor: colors.warning, backgroundColor: colors.warningBg }}>
            <Text style={[typography.body, { color: colors.warning }]}>
              {totalUnverified} credential{totalUnverified === 1 ? '' : 's'} {totalUnverified === 1 ? 'needs' : 'need'} verification — only verified keys are used for AI calls. Press Verify on the card.
            </Text>
          </Card>
        ) : null}

        {groups.map((group) => (
          <Section key={group.type} title={`${group.type} (${group.items.length})`}>
            {group.items.map((credential) => {
              const health = healthView(credential);
              const type = types.data?.find((t) => t.id === credential.credential_type);
              const masked = maskedKey(credential);
              return (
                <ListRow
                  key={credential.id}
                  icon={credentialIcon(type?.icon)}
                  title={credential.name}
                  subtitle={masked ?? credential.credential_type_display}
                  onPress={() => router.push(`/more/credentials/${credential.id}`)}
                  detail={
                    <Text style={[typography.caption, { color: toneColor(health.tone, colors) }]}>{health.text}</Text>
                  }
                />
              );
            })}
          </Section>
        ))}

        {visible.length === 0 ? (
          filtered.length === 0 && all.length === 0 ? (
            <View style={{ gap: spacing.md, alignItems: 'center', paddingVertical: spacing.xl }}>
              <EmptyState
                title="No credentials yet"
                message="Add your first provider key — then press Verify so it can be used for AI calls."
              />
              <Button title="Add First Credential" onPress={() => router.push('/more/credentials/form')} />
            </View>
          ) : (
            <EmptyState
              title={
                filtered.length === 0
                  ? 'No credentials match this search'
                  : filter === 'verified'
                    ? 'No verified credentials'
                    : 'Everything is verified'
              }
              message={
                filtered.length === 0
                  ? 'Try a different word.'
                  : filter === 'verified'
                    ? "You haven't verified any credentials yet. Press Verify on a card to ensure it works."
                    : 'All your credentials are verified. Great job!'
              }
            />
          )
        ) : null}

        <Text style={{ color: colors.mutedText, fontSize: fontSize.sm }}>
          {`${all.length} saved`}
        </Text>
      </ScrollView>
    </Screen>
  );
}
