import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { confirm } from '../../components/confirm';
import { ErrorState } from '../../components/ErrorState';
import { ErrorText } from '../../components/ErrorText';
import { Icon } from '../../components/Icon';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useRefresh } from '../../hooks/useRefresh';
import { useIsLive } from '../../hooks/usePolling';
import { absolute, relative } from '../schedules/format';
import { messageOf } from '../agents/format';
import { useAgents } from '../agents/queries';
import { RowDivider, RunRow } from '../runs/RunRow';
import { success, warning } from '../../lib/haptics';
import { spacing, typography, useTheme } from '../../theme';
import { isLiveMission, MISSION_STATUS_LABEL, missionStatusTone, rupees, stepsOf } from './MissionCard';
import { useDeleteMission, useMission, useMissionAction, useMissionRuns } from './queries';
import type { MissionDetail } from './types';

/** One mission in full: its plan, its last report, its spend, its controls, and the recent runs it started. */
export function MissionDetailScreen({ missionId }: { missionId: number }) {
  const router = useRouter();
  const { colors } = useTheme();
  const watching = useIsLive();
  const mission = useMission(missionId, watching);
  const runs = useMissionRuns(missionId, watching);
  const agents = useAgents();
  const action = useMissionAction();
  const remove = useDeleteMission();
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([mission.refetch(), runs.refetch()]));

  if (mission.isPending) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Mission' }} />
        <LoadingState text="Loading mission" />
      </Screen>
    );
  }

  if (mission.isError || !mission.data) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Mission' }} />
        <ErrorState message={messageOf(mission.error, 'That mission could not be loaded.')} onRetry={() => void mission.refetch()} />
      </Screen>
    );
  }

  const m: MissionDetail = mission.data;
  const live = isLiveMission(m.status);
  const steps = stepsOf(m);
  const agentName = agents.data?.find((a) => a.id === m.agent_id)?.name;

  const onCancel = async () => {
    const ok = await confirm({
      title: 'Cancel this mission?',
      message: `"${m.goal}" stops for good. Past runs stay in the run list.`,
      destructiveLabel: 'Cancel mission',
    });
    if (!ok) return;
    warning();
    action.mutate({ id: m.id, verb: 'cancel' });
  };

  const onDelete = async () => {
    const ok = await confirm({
      title: 'Delete this mission?',
      message: `"${m.goal}" goes away. Past runs stay in the run list.`,
      destructiveLabel: 'Delete mission',
    });
    if (!ok) return;
    warning();
    remove.mutate(m.id, { onSuccess: () => router.back() });
  };

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: 'Mission' }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Card style={styles.block}>
          <View style={styles.badges}>
            <Badge label={MISSION_STATUS_LABEL[m.status]} tone={missionStatusTone(m.status)} />
            <Text style={[typography.caption, { color: colors.mutedText }]}>{`Mission #${m.id}`}</Text>
          </View>
          <Text selectable style={[typography.heading, { color: colors.text }]}>{m.goal}</Text>
          <Fact label="Spent" value={`${rupees(m.spent_inr)} of ${rupees(m.budget_inr)}`} />
          <Fact label="Runs" value={`${m.runs_done} of ${m.max_runs}`} />
          {steps ? <Fact label="Steps" value={`${steps.done} of ${steps.total}`} /> : null}
          {agentName ? <Fact label="Agent" value={agentName} /> : null}
          {m.deadline ? <Fact label="Deadline" value={absolute(m.deadline)} /> : null}
          {m.next_wake_at && live ? <Fact label="Next wake" value={relative(m.next_wake_at)} /> : null}
        </Card>

        {m.last_report ? (
          <Card style={styles.block}>
            <Text style={[typography.label, { color: colors.text }]}>Last report</Text>
            <Text selectable style={[typography.body, { color: colors.text }]}>{m.last_report}</Text>
          </Card>
        ) : null}

        {m.plan && m.plan.length > 0 ? (
          <Card style={styles.block}>
            <Text style={[typography.label, { color: colors.text }]}>Plan</Text>
            {m.plan.map((step, i) => {
              const done = step.status === 'done';
              return (
                <View key={`${i}-${step.text}`} style={styles.step}>
                  <Icon name={done ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={done ? colors.success : colors.mutedText} />
                  <Text style={[typography.body, styles.grow, { color: done ? colors.mutedText : colors.text }]}>{step.text}</Text>
                </View>
              );
            })}
          </Card>
        ) : null}

        <View style={styles.controls}>
          {live ? (
            <Button
              title={m.status === 'paused' ? 'Resume' : 'Pause'}
              variant="secondary"
              loading={action.isPending && action.variables?.verb !== 'cancel'}
              onPress={() => {
                const verb = m.status === 'paused' ? 'resume' : 'pause';
                action.mutate({ id: m.id, verb }, { onSuccess: () => success() });
              }}
            />
          ) : null}
          {live ? <Button title="Cancel mission" variant="secondary" onPress={() => void onCancel()} /> : null}
          {!live ? <Button title="Delete mission" variant="secondary" onPress={() => void onDelete()} loading={remove.isPending} /> : null}
        </View>
        <ErrorText message={action.isError ? messageOf(action.error, 'That did not work.') : null} />
        <ErrorText message={remove.isError ? messageOf(remove.error, 'That did not work.') : null} />

        <Card padded={false} style={styles.runs}>
          <Text style={[typography.label, styles.runsHead, { color: colors.text }]}>Runs so far</Text>
          {runs.isPending ? (
            <Text style={[typography.caption, styles.runsHead, { color: colors.mutedText }]}>Loading runs…</Text>
          ) : runs.isError ? (
            <Text style={[typography.caption, styles.runsHead, { color: colors.danger }]}>
              {messageOf(runs.error, 'Runs could not be loaded.')}
            </Text>
          ) : (runs.data ?? []).length === 0 ? (
            <Text style={[typography.caption, styles.runsHead, { color: colors.mutedText }]}>
              No runs yet. The sweep starts them as the mission goes on.
            </Text>
          ) : (
            (runs.data ?? []).map((run, i) => (
              <View key={run.execution_id}>
                {i > 0 ? <RowDivider /> : null}
                <RunRow
                  run={run}
                  selectMode={false}
                  selected={false}
                  onPress={() => router.push(`/more/runs/${encodeURIComponent(run.execution_id)}`)}
                  onLongPress={() => undefined}
                />
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.fact}>
      <Text style={[typography.caption, { color: colors.mutedText }]}>{label}</Text>
      <Text style={[typography.body, { color: colors.text, flexShrink: 1, textAlign: 'right' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  block: { gap: spacing.sm },
  badges: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  fact: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.xs },
  grow: { flex: 1 },
  controls: { gap: spacing.sm },
  runs: { overflow: 'hidden' },
  runsHead: { padding: spacing.lg, paddingBottom: spacing.sm },
});
