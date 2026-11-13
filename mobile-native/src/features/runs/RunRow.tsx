import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../../components/Text';

import { Badge } from '../../components/Badge';
import { Icon } from '../../components/Icon';
import { StatusPill } from '../../components/StatusPill';
import { formatDuration, formatRelative } from '../agents/format';
import { pressedOpacity, spacing, typography, useTheme } from '../../theme';
import { CALLER_LABEL, FAILURE_LABEL, formatCostInr, isDeletableRun } from './format';
import type { ExecutionLog, FailureCategory } from './types';

interface Props {
  run: ExecutionLog;
  selectMode: boolean;
  selected: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

/**
 * One run in the list. In select mode only finished, non-evaluation runs can be
 * picked: a live run refuses deletion on the server, and an evaluation run is
 * deleted with its sweep, so the row is dimmed rather than offered.
 */
export function RunRow({ run, selectMode, selected, onPress, onLongPress }: Props) {
  const { colors } = useTheme();
  const deletable = isDeletableRun(run);
  const disabled = selectMode && !deletable;
  const title = run.workflow_name ?? 'Deleted agent';
  const failure =
    run.status === 'failed' && run.failure_category
      ? (FAILURE_LABEL[run.failure_category as FailureCategory] ?? null)
      : null;
  const meta = [CALLER_LABEL[run.caller] ?? run.trigger_type, formatRelative(run.created_at), failure]
    .filter(Boolean)
    .join(' · ');
  const money = `${formatCostInr(run.cost_usd, run.cost_source)} · ${formatDuration(run.duration_ms)}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${run.status}, ${meta}`}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={!selectMode && deletable ? onLongPress : undefined}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: selected ? colors.infoBg : colors.surface,
          opacity: disabled ? 0.45 : pressed ? pressedOpacity : 1,
        },
      ]}
    >
      {selectMode ? (
        <Icon
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={24}
          color={selected ? colors.primary : colors.mutedText}
        />
      ) : null}
      <View style={styles.main}>
        <View style={styles.titleLine}>
          <Text style={[typography.label, styles.title, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
          {run.is_delegated ? (
            <Icon name="git-branch-outline" size={16} color={colors.mutedText} />
          ) : null}
          {run.mission_id != null ? <Badge label={`#${run.mission_id}`} tone="info" /> : null}
        </View>
        <Text style={[typography.caption, { color: colors.mutedText }]} numberOfLines={2}>
          {meta}
        </Text>
        <Text style={[typography.caption, { color: colors.mutedText }]} numberOfLines={1}>
          {money}
        </Text>
      </View>
      <StatusPill status={run.status} />
    </Pressable>
  );
}

/** A hairline between two rows. */
export function RowDivider() {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
}

const styles = StyleSheet.create({
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  main: { flex: 1, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flexShrink: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: spacing.lg },
});
