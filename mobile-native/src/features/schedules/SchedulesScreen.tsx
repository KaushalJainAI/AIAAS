import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Icon } from '../../components/Icon';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useRefresh } from '../../hooks/useRefresh';
import { useIsLive } from '../../hooks/usePolling';
import { messageOf } from '../agents/format';
import { useAgents } from '../agents/queries';
import { radius, spacing, typography, useTheme } from '../../theme';
import { relative } from './format';
import { ScheduleSheet } from './ScheduleSheet';
import { TriggerCard } from './TriggerCard';
import { useSchedulerHealth, useTriggers } from './queries';
import type { Trigger, TriggerMode } from './types';

interface Sheet {
  mode: TriggerMode;
  trigger: Trigger | null;
}

/** Schedules and webhooks, grouped by agent, with the scheduler's own health on top. */
export function SchedulesScreen() {
  const { colors } = useTheme();
  const watching = useIsLive();
  const triggers = useTriggers(watching);
  const health = useSchedulerHealth(watching);
  const agents = useAgents();
  const [sheet, setSheet] = useState<Sheet | null>(null);

  const refetchAll = useCallback(
    () => Promise.all([triggers.refetch(), health.refetch()]),
    [triggers, health],
  );
  const { refreshing, onRefresh } = useRefresh(refetchAll);

  const list = useMemo(() => triggers.data ?? [], [triggers.data]);
  const groups = useMemo(() => {
    const byAgent = new Map<number, { name: string; items: Trigger[] }>();
    for (const t of list) {
      const group = byAgent.get(t.subagent) ?? { name: t.agent_name, items: [] };
      group.items.push(t);
      byAgent.set(t.subagent, group);
    }
    return [...byAgent.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [list]);

  const newSchedule = () => setSheet({ mode: 'schedule', trigger: null });
  const newWebhook = () => setSheet({ mode: 'webhook', trigger: null });

  const actions = (
    <View style={styles.topRow}>
      <Button title="New webhook" variant="secondary" onPress={newWebhook} />
      <Button title="New schedule" onPress={newSchedule} />
    </View>
  );

  if (triggers.isPending) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <LoadingState text="Loading schedules" />
      </Screen>
    );
  }

  if (triggers.isError) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <ErrorState message={messageOf(triggers.error, 'Schedules could not be loaded.')} onRetry={() => void triggers.refetch()} />
      </Screen>
    );
  }

  const schedulerDown = health.data && !health.data.running && list.some((t) => t.enabled);

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {schedulerDown ? (
          <View style={[styles.banner, { backgroundColor: colors.dangerBg, borderColor: colors.danger }]} accessibilityRole="alert">
            <Icon name="warning-outline" size={18} color={colors.danger} />
            <Text style={[typography.caption, styles.grow, { color: colors.danger }]}>
              {`Schedules are not running right now. The scheduler last checked in ${health.data?.last_tick_at ? relative(health.data.last_tick_at) : 'never'}.`}
            </Text>
          </View>
        ) : null}

        {list.length === 0 ? (
          <>
            <EmptyState
              title="Nothing runs on its own yet"
              message="Pick an agent and choose what starts it: a schedule, checked against the next few dates before you save, or a webhook URL another system can call. Either way the agent needs “may run with nobody watching” turned on, or every run is refused."
            />
            {actions}
          </>
        ) : (
          <>
            {actions}
            {groups.map(([agentId, group]) => (
              <View key={agentId} style={styles.group}>
                <View style={styles.groupHead}>
                  <Text accessibilityRole="header" style={[typography.label, styles.grow, { color: colors.text }]} numberOfLines={1}>
                    {group.name}
                  </Text>
                  <Text style={[typography.caption, { color: colors.mutedText }]}>
                    {`${group.items.length} ${group.items.length === 1 ? 'schedule' : 'schedules'}`}
                  </Text>
                </View>
                {group.items.map((t) => (
                  <TriggerCard key={t.id} trigger={t} onEdit={() => setSheet({ mode: t.mode, trigger: t })} />
                ))}
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <ScheduleSheet
        visible={sheet !== null}
        onClose={() => setSheet(null)}
        mode={sheet?.mode ?? 'schedule'}
        trigger={sheet?.trigger ?? null}
        agents={agents.data ?? []}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  content: { gap: spacing.lg, paddingBottom: spacing.xl },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  topRow: { flexDirection: 'row', gap: spacing.md, justifyContent: 'flex-end' },
  group: { gap: spacing.md },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
