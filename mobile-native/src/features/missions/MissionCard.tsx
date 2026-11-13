import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, type Tone } from '../../components/Badge';
import { Card } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { Text } from '../../components/Text';
import { pressedOpacity, radius, spacing, typography, useTheme } from '../../theme';
import { relative } from '../schedules/format';
import type { Mission, MissionStatus } from './types';

export const MISSION_STATUS_LABEL: Record<MissionStatus, string> = {
  active: 'Active',
  waiting: 'Waiting',
  paused: 'Paused',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const MISSION_TONE: Record<MissionStatus, Tone> = {
  active: 'info',
  waiting: 'info',
  paused: 'neutral',
  done: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

export function missionStatusTone(status: MissionStatus): Tone {
  return MISSION_TONE[status];
}

/** Rupees as the web writes them: ₹1,250. */
export function rupees(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

/** Steps done out of the plan's total, when the plan has steps. */
export function stepsOf(mission: Mission): { done: number; total: number } | null {
  if (!mission.total_todos) return null;
  return { done: mission.total_todos - (mission.open_todos ?? 0), total: mission.total_todos };
}

/** One mission in the list: status, progress, budget, and the goal in its own words. */
export function MissionCard({ mission, onPress }: { mission: Mission; onPress: () => void }) {
  const { colors } = useTheme();
  const steps = stepsOf(mission);
  const live = isLiveMission(mission.status);
  const fraction = steps && steps.total > 0 ? Math.min(1, steps.done / steps.total) : 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Mission: ${mission.goal}, ${MISSION_STATUS_LABEL[mission.status]}`}
      onPress={onPress}
      style={({ pressed }) => [{ opacity: pressed ? pressedOpacity : 1 }]}
    >
      <Card style={styles.card}>
        <View style={styles.badges}>
          <Badge label={MISSION_STATUS_LABEL[mission.status]} tone={missionStatusTone(mission.status)} />
          <Text style={[typography.caption, { color: colors.mutedText }]}>
            {`${mission.runs_done}/${mission.max_runs} runs · ${rupees(mission.spent_inr)} of ${rupees(mission.budget_inr)}`}
          </Text>
          {steps ? (
            <Text style={[typography.caption, { color: colors.mutedText }]}>{`${steps.done}/${steps.total} steps`}</Text>
          ) : null}
        </View>
        <Text style={[typography.label, { color: colors.text }]} numberOfLines={3}>
          {mission.goal}
        </Text>
        {steps && steps.total > 0 ? (
          <View style={[styles.track, { backgroundColor: colors.border }]}>
            <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%`, backgroundColor: colors.primary }]} />
          </View>
        ) : null}
        {mission.next_wake_at && live ? (
          <View style={styles.wake}>
            <Icon name="time-outline" size={14} color={colors.mutedText} />
            <Text style={[typography.caption, { color: colors.mutedText }]}>{`Next wake ${relative(mission.next_wake_at)}`}</Text>
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

/** A mission that can still move: active, waiting for its next wake, or paused. */
export function isLiveMission(status: MissionStatus): boolean {
  return status === 'active' || status === 'waiting' || status === 'paused';
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  track: { height: 6, borderRadius: radius.sm, overflow: 'hidden' },
  fill: { height: 6 },
  wake: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
