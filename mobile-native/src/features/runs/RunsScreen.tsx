import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { ErrorText } from '../../components/ErrorText';
import { Icon } from '../../components/Icon';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Text } from '../../components/Text';
import { confirm } from '../../components/confirm';
import { useRefresh } from '../../hooks/useRefresh';
import { useIsLive } from '../../hooks/usePolling';
import { messageOf } from '../agents/format';
import { useAgents } from '../agents/queries';
import { warning } from '../../lib/haptics';
import { pressedOpacity, radius, spacing, typography, useTheme } from '../../theme';
import { InsightsView } from './InsightsView';
import { LiveSection } from './LiveSection';
import { isDeletableRun } from './format';
import { RunFilterSheet } from './RunFilterSheet';
import { RunRow, RowDivider } from './RunRow';
import { monthSpendLabel } from './spend';
import { useBulkDeleteRuns, useLiveActivity, useRunList, useSpendSummary, type RunListFilters } from './queries';
import type { ExecutionLog } from './types';

type Segment = 'runs' | 'insights';

const SEGMENTS: { key: Segment; label: string; count: number }[] = [
  { key: 'runs', label: 'Runs', count: 0 },
  { key: 'insights', label: 'Insights', count: 0 },
];

/** Runs (the live list, the history, bulk delete) and Insights, as two segments. */
export function RunsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const watching = useIsLive();
  const [segment, setSegment] = useState<Segment>('runs');
  const [filters, setFilters] = useState<RunListFilters>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const list = useRunList(filters, watching);
  const live = useLiveActivity(watching);
  const spend = useSpendSummary();
  const agents = useAgents();
  const bulk = useBulkDeleteRuns();

  const rows = useMemo<ExecutionLog[]>(
    () => (list.data?.pages ?? []).flatMap((page) => page.results),
    [list.data],
  );

  const refetchAll = useCallback(() => Promise.all([list.refetch(), live.refetch()]), [list, live]);
  const { refreshing, onRefresh } = useRefresh(refetchAll);

  const activeFilterCount = [filters.status, filters.caller, filters.workflow_id, filters.failure_category].filter(
    (v) => v !== undefined && v !== null,
  ).length;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const onDeleteSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const many = ids.length > 1;
    const ok = await confirm({
      title: many ? `Delete ${ids.length} runs?` : 'Delete this run?',
      message: "Their traces go away. Cost records are kept so spend totals don't drop. This cannot be undone.",
      destructiveLabel: 'Delete',
    });
    if (!ok) return;
    warning();
    bulk.mutate(
      { ids },
      { onSuccess: () => exitSelect() },
    );
  };

  const header = (
    <View style={{ gap: spacing.md }}>
      <SegmentedControl items={SEGMENTS} value={segment} onChange={setSegment} />
      {spend.data && monthSpendLabel(spend.data) ? (
        <Text style={[typography.caption, { color: colors.mutedText }]}>{monthSpendLabel(spend.data)}</Text>
      ) : null}
    </View>
  );

  if (segment === 'insights') {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        {header}
        <InsightsView />
      </Screen>
    );
  }

  if (list.isPending) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        {header}
        <LoadingState text="Loading runs" />
      </Screen>
    );
  }

  if (list.isError) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        {header}
        <ErrorState message={messageOf(list.error, 'Runs could not be loaded.')} onRetry={() => void list.refetch()} />
      </Screen>
    );
  }

  const toolbar = (
    <View style={{ gap: spacing.sm }}>
      <LiveSection items={live.data?.items ?? []} truncated={live.data?.truncated ?? false} note={live.data?.note ?? ''} />
      {selecting ? (
        <View style={[styles.toolbar, { borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.md }]}>
          <Text style={[typography.label, { color: colors.text, flex: 1 }]}>{`${selected.size} selected`}</Text>
          <ToolbarButton label="Cancel" onPress={exitSelect} />
          <ToolbarButton
            label="Delete"
            danger
            disabled={selected.size === 0 || bulk.isPending}
            onPress={() => void onDeleteSelected()}
          />
        </View>
      ) : (
        <View style={styles.toolbarRow}>
          <ToolbarButton
            label={activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filters'}
            icon="options-outline"
            onPress={() => setFilterOpen(true)}
          />
          <ToolbarButton label="Select" icon="checkbox-outline" onPress={() => setSelecting(true)} />
        </View>
      )}
      <ErrorText message={bulk.isError ? messageOf(bulk.error, 'Those runs could not be deleted.') : null} />
    </View>
  );

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      {header}
      <FlatList
        data={rows}
        keyExtractor={(run) => run.execution_id}
        ItemSeparatorComponent={RowDivider}
        ListHeaderComponent={toolbar}
        contentContainerStyle={styles.list}
        style={[styles.flex, { backgroundColor: colors.background }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        renderItem={({ item: run }) => (
          <RunRow
            run={run}
            selectMode={selecting}
            selected={selected.has(run.execution_id)}
            onPress={() => {
              if (selecting) {
                if (isDeletableRun(run)) toggle(run.execution_id);
                return;
              }
              router.push(`/more/runs/${encodeURIComponent(run.execution_id)}`);
            }}
            onLongPress={() => {
              setSelecting(true);
              toggle(run.execution_id);
            }}
          />
        )}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          activeFilterCount > 0 ? (
            <View style={styles.empty}>
              <EmptyState title="No runs match these filters" message="Your other runs are hidden by the filter." />
              <View style={{ marginTop: spacing.md, alignSelf: 'stretch' }}>
                <Button title="Show all runs" variant="secondary" onPress={() => setFilters({})} />
              </View>
            </View>
          ) : (
            <View style={styles.empty}>
              <EmptyState
                title="No activity yet"
                message="Once your agents run, they appear here. When one reaches a step it isn't allowed to take on its own, it stops and asks in the Inbox."
              />
            </View>
          )
        }
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <View style={styles.footer}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : list.hasNextPage ? (
            <View style={styles.footer}>
              <Button title="Load more" variant="secondary" onPress={() => void list.fetchNextPage()} />
            </View>
          ) : undefined
        }
      />

      <RunFilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        value={filters}
        agents={agents.data ?? []}
        onApply={(next) => setFilters(next)}
      />
    </Screen>
  );
}

function ToolbarButton({
  label,
  icon,
  danger = false,
  disabled = false,
  onPress,
}: {
  label: string;
  icon?: 'options-outline' | 'checkbox-outline';
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const tone = danger ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.toolbarButton,
        {
          borderColor: colors.border,
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          opacity: disabled ? 0.45 : pressed ? pressedOpacity : 1,
        },
      ]}
    >
      {icon ? <Icon name={icon} size={16} color={colors.text} /> : null}
      <Text style={[typography.label, { color: tone }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingBottom: spacing.xl },
  toolbarRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  toolbarButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  empty: { paddingVertical: spacing.xl, alignItems: 'center' },
  footer: { paddingVertical: spacing.lg },
});
