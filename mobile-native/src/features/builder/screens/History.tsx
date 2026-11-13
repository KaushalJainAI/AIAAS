/**
 * Change history: every saved version of one agent, newest first, with the fields
 * each change touched and how many runs used that version. Put an earlier version
 * back with a confirm. The restore is saved as a new version, so nothing is lost.
 */
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';

import { Button } from '../../../components/Button';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { LoadingState } from '../../../components/LoadingState';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { confirm } from '../../../components/confirm';
import { messageOf } from '../../agents/format';
import { success, warning } from '../../../lib/haptics';
import { useRefresh } from '../../../hooks/useRefresh';
import { spacing, typography, useTheme } from '../../../theme';
import { refusalFrom } from '../refusal';
import { useAgentRevisionPages, useRestoreRevision } from '../queries';
import type { AgentRevision } from '../types';
import { Notice, Panel } from '../ui';

const COLLAPSED_FIELDS = 6;

/** One side of a diff, shortened to fit a line. Objects are summarised, not stringified. */
function summarise(value: unknown): string {
  if (value === null || value === undefined) return 'none';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (Array.isArray(value)) return value.length === 0 ? 'none' : `${value.length} item(s)`;
  if (typeof value === 'object') {
    const on = Object.entries(value as Record<string, unknown>).filter(([, v]) => v).map(([k]) => k);
    return on.length === 0 ? 'none' : on.join(', ');
  }
  const text = String(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

export function AgentHistoryScreen({ id }: { id: string }) {
  const agentId = Number(id);
  const { colors } = useTheme();
  const pages = useAgentRevisionPages(agentId);
  const restore = useRestoreRevision(agentId);
  const [error, setError] = useState<string | null>(null);
  const { refreshing, onRefresh } = useRefresh(pages.refetch);

  const revisions: AgentRevision[] = pages.data?.pages.flatMap((p) => p.results) ?? [];
  const total = pages.data?.pages[0]?.count ?? null;

  const onRestore = async (rev: AgentRevision) => {
    const ok = await confirm({
      title: `Put this agent back to version ${rev.number}?`,
      message: 'Your current settings stay in the history.',
      destructiveLabel: 'Restore',
    });
    if (!ok) return;
    setError(null);
    try {
      await restore.mutateAsync(rev.number);
      success();
    } catch (err) {
      warning();
      setError(refusalFrom(err, `Could not restore version ${rev.number}.`).summary || messageOf(err, 'Could not restore that version.'));
    }
  };

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: 'Change history' }} />
      {pages.isPending ? <LoadingState text="Loading history" /> : null}
      {pages.isError ? (
        <ErrorState message={messageOf(pages.error, 'This history could not be loaded. The agent may have been deleted.')} onRetry={() => void pages.refetch()} />
      ) : null}
      {pages.isSuccess && revisions.length === 0 ? (
        <EmptyState title="No changes yet" message="Future saves will be tracked here." />
      ) : null}
      {revisions.length > 0 ? (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xxl }}
        >
          {total != null ? (
            <Text style={[typography.caption, { color: colors.mutedText }]}>
              Showing {revisions.length} of {total} {total === 1 ? 'change' : 'changes'}
            </Text>
          ) : null}
          {error ? <Notice text={error} /> : null}
          {revisions.map((rev, i) => (
            <RevisionCard
              key={rev.id}
              revision={rev}
              current={i === 0}
              restoring={restore.isPending && restore.variables === rev.number}
              onRestore={() => void onRestore(rev)}
            />
          ))}
          {pages.hasNextPage ? (
            <Button
              title={pages.isFetchingNextPage ? 'Loading…' : 'Show more'}
              variant="secondary"
              loading={pages.isFetchingNextPage}
              onPress={() => void pages.fetchNextPage()}
            />
          ) : null}
        </ScrollView>
      ) : null}
    </Screen>
  );
}

function RevisionCard({ revision, current, restoring, onRestore }: {
  revision: AgentRevision;
  current: boolean;
  restoring: boolean;
  onRestore: () => void;
}) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const fields = Object.entries(revision.diff);
  const shown = expanded ? fields : fields.slice(0, COLLAPSED_FIELDS);
  const hidden = fields.length - shown.length;
  return (
    <Panel>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text style={[typography.label, { color: colors.text }]}>v{revision.number}</Text>
        {current ? <Text style={[typography.caption, { color: colors.primary }]}>current</Text> : null}
        <Text style={[typography.caption, { color: colors.mutedText, marginLeft: 'auto' }]}>
          {revision.run_count} {revision.run_count === 1 ? 'run' : 'runs'}
        </Text>
      </View>
      <Text style={[typography.body, { color: colors.text }]}>{revision.summary}</Text>
      <Text style={[typography.caption, { color: colors.mutedText }]}>
        {revision.changed_by ?? 'system'} · {new Date(revision.created_at).toLocaleString()}
      </Text>
      {shown.map(([field, change]) => (
        <View key={field} style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Text numberOfLines={1} style={[typography.caption, { color: colors.mutedText, width: 110 }]}>{field}</Text>
          <Text style={[typography.caption, { color: colors.text, flex: 1 }]}>
            {summarise(change.from)} → {summarise(change.to)}
          </Text>
        </View>
      ))}
      {hidden > 0 ? (
        <Text
          accessibilityRole="button"
          onPress={() => setExpanded(true)}
          style={[typography.caption, { color: colors.primary }]}
        >
          Show {hidden} more {hidden === 1 ? 'field' : 'fields'}
        </Text>
      ) : null}
      {!current ? (
        <Button title={restoring ? 'Restoring…' : 'Restore this version'} variant="secondary" loading={restoring} onPress={onRestore} />
      ) : null}
    </Panel>
  );
}
