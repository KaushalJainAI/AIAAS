import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { Icon } from '../../components/Icon';
import { confirm } from '../../components/confirm';
import { ErrorText } from '../../components/ErrorText';
import { Sheet } from '../../components/Sheet';
import { StatusPill } from '../../components/StatusPill';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { messageOf } from '../agents/format';
import { pressedOpacity, radius, spacing, typography, useTheme } from '../../theme';
import { success, warning } from '../../lib/haptics';
import { markExecutionFailed, steerRun, stopLiveItem } from './api';
import { LIVE_ACTION_LABEL, LIVE_KIND_LABEL, liveActions, type LiveAction } from './format';
import { runKeys } from './queries';
import type { LiveItem } from './types';

interface Props {
  items: LiveItem[];
  truncated: boolean;
  note: string;
}

/**
 * Every live process of any kind, above the run list. Each row offers only the
 * controls the server lists for it in `actions`. Hidden when nothing is live.
 */
export function LiveSection({ items, truncated, note }: Props) {
  const { colors, radius: r } = useTheme();
  if (items.length === 0) return null;
  return (
    <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: r.md }]}>
      <View style={styles.header}>
        <Icon name="pulse-outline" size={18} color={colors.primary} />
        <Text accessibilityRole="header" style={[typography.label, { color: colors.text, flex: 1 }]}>
          Running now
        </Text>
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          {`${items.length} live${truncated ? '+' : ''}`}
        </Text>
      </View>
      {items.map((item) => (
        <View key={`${item.kind}:${item.id}`}>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <LiveRow item={item} />
        </View>
      ))}
      {note ? (
        <Text style={[typography.caption, styles.note, { color: colors.mutedText }]}>{note}</Text>
      ) : null}
    </View>
  );
}

function LiveRow({ item }: { item: LiveItem }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const [steering, setSteering] = useState(false);
  const [steerText, setSteerText] = useState('');
  const actions = liveActions(item);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: runKeys.live });
    void queryClient.invalidateQueries({ queryKey: runKeys.all });
  };

  const stop = useMutation({
    mutationFn: () => stopLiveItem(item),
    onSuccess: refresh,
  });

  const steer = useMutation({
    mutationFn: (message: string) => steerRun(item.id, message),
    onSuccess: () => {
      success();
      setSteerText('');
      setSteering(false);
      refresh();
    },
  });

  const markFailed = useMutation({
    mutationFn: () => markExecutionFailed(item.id),
    onSuccess: () => {
      success();
      refresh();
    },
  });

  const onStop = async () => {
    const ok = await confirm({
      title: 'Stop this run?',
      message: 'Stopping cannot be undone.',
      destructiveLabel: 'Stop',
    });
    if (!ok) return;
    warning();
    stop.mutate();
  };

  const onMarkFailed = async () => {
    const ok = await confirm({
      title: 'Mark this run as failed?',
      message: `"${item.title}" is past its run limit and looks stuck. This closes it as failed so it stops counting as live.`,
      destructiveLabel: 'Mark as failed',
    });
    if (!ok) return;
    warning();
    markFailed.mutate();
  };

  const open = () => {
    if (item.kind === 'agent_run') {
      router.push(`/more/runs/${encodeURIComponent(item.id)}`);
      return;
    }
    if (item.href.startsWith('/') && !item.href.startsWith('//')) {
      router.push({ pathname: '/web', params: { path: item.href, title: LIVE_KIND_LABEL[item.kind] ?? 'Open' } });
    }
  };

  const onAction = (action: LiveAction) => {
    if (action === 'stop') void onStop();
    else if (action === 'steer') setSteering(true);
    else if (action === 'mark_failed') void onMarkFailed();
    else open();
  };

  const startedLine = item.started_at
    ? `${LIVE_KIND_LABEL[item.kind] ?? item.kind}`
    : `${LIVE_KIND_LABEL[item.kind] ?? item.kind} · running ${formatElapsed(item.elapsed_s)}`;
  const spend = item.spend_rupees != null && item.spend_rupees > 0 ? ` · ₹${item.spend_rupees.toLocaleString('en-IN')}` : '';
  const delegated = item.is_delegated ? ' · by another agent' : '';

  return (
    <View style={styles.row}>
      <View style={styles.titleLine}>
        <View style={styles.main}>
          <Text style={[typography.label, { color: colors.text }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[typography.caption, { color: colors.mutedText }]} numberOfLines={2}>
            {`${startedLine}${item.elapsed_s != null ? ` · ${formatElapsed(item.elapsed_s)} elapsed` : ''}${spend}${delegated}`}
          </Text>
          {item.stuck ? (
            <Text style={[typography.caption, { color: colors.danger }]}>stuck past its run limit</Text>
          ) : null}
        </View>
        {item.kind === 'agent_run' ? (
          <StatusPill status={item.status} />
        ) : (
          <Badge label={item.status} tone="neutral" />
        )}
      </View>

      {actions.length > 0 ? (
        <View style={styles.actions}>
          {actions.map((action) => (
            <SmallButton
              key={action}
              label={LIVE_ACTION_LABEL[action]}
              danger={action === 'stop' || action === 'mark_failed'}
              onPress={() => onAction(action)}
            />
          ))}
        </View>
      ) : null}

      <ErrorText message={stop.isError ? messageOf(stop.error, 'Could not stop it.') : null} />
      <ErrorText message={markFailed.isError ? messageOf(markFailed.error, 'Could not mark it failed.') : null} />

      <Sheet visible={steering} onClose={() => setSteering(false)} title="Steer this run">
        <View style={{ gap: spacing.md, paddingBottom: spacing.sm }}>
          <TextField
            label="Instruction"
            value={steerText}
            onChangeText={setSteerText}
            placeholder="Tell it something, e.g. also check the pricing page"
            multiline
            editable={!steer.isPending}
            style={{ minHeight: 88, textAlignVertical: 'top' }}
          />
          <ErrorText message={steer.isError ? messageOf(steer.error, 'Could not send that.') : null} />
          <Button
            title="Send"
            onPress={() => {
              const text = steerText.trim();
              if (text) steer.mutate(text);
            }}
            loading={steer.isPending}
            disabled={!steerText.trim()}
          />
        </View>
      </Sheet>
    </View>
  );
}

function SmallButton({ label, danger, onPress }: { label: string; danger: boolean; onPress: () => void }) {
  const { colors, radius: r } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.small,
        {
          borderColor: danger ? colors.danger : colors.border,
          borderRadius: r.md,
          opacity: pressed ? pressedOpacity : 1,
        },
      ]}
    >
      <Text style={[typography.label, { color: danger ? colors.danger : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

function formatElapsed(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}


const styles = StyleSheet.create({
  section: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', marginBottom: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
  divider: { height: StyleSheet.hairlineWidth },
  note: { padding: spacing.lg, paddingTop: spacing.sm },
  row: { padding: spacing.lg },
  titleLine: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  main: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  small: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
});
