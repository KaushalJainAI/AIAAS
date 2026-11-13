/**
 * A card a slash command returns: a status, a confirm sheet, a list of findings.
 * Covers the card types the phone can finish on its own. The confirm sheets are
 * the approval (pressing the primary button is the decision), so their payload
 * goes back to `/chat/commands/confirm/` unchanged from what the card holds.
 * Types the phone cannot finish are sent to the matching native screen.
 */
import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { fontFamily } from '../../fonts';
import { spacing, typography, useTheme } from '../../theme';
import { str, arr, obj } from './frames';
import type { CommandCardData } from './types';

interface Props {
  card: CommandCardData;
  busy?: boolean;
  /** Carries out a confirm-sheet decision: the values the card's fields hold. */
  onConfirm?: (confirm: Record<string, unknown>) => void;
  onCancel?: () => void;
}

function Shell({ title, children }: { title: string; children: ReactNode }) {
  const { colors, spacing: s, radius: r } = useTheme();
  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface, borderRadius: r.md, gap: s.sm }]}>
      <Text style={[typography.label, { color: colors.text }]}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[typography.caption, { color: colors.mutedText, width: 96 }]}>{label}</Text>
      <Text style={[typography.body, { color: colors.text, flex: 1 }]}>{value}</Text>
    </View>
  );
}

/** Opens a native screen for a card type the phone reads but does not decide on. */
function openNative(path: string) {
  router.push(path as never);
}

export function CommandCard({ card, busy = false, onConfirm, onCancel }: Props) {
  const { colors: { mutedText } } = useTheme();
  switch (card.type) {
    case 'agent_run':
      return (
        <Shell title={str(card.agent_name) || 'Agent'}>
          <Row label="Status" value={str(card.status) || 'running'} />
          <Button
            title="Open run"
            variant="secondary"
            onPress={() => router.push({ pathname: '/agents/run/[executionId]', params: { executionId: str(card.execution_id) } })}
          />
        </Shell>
      );
    case 'status':
      return (
        <Shell title="Status">
          {(['runs', 'pending_approvals', 'missions', 'todos_open'] as const).map((key) =>
            typeof card[key] === 'number' ? (
              <Row key={key} label={key.replace(/_/g, ' ')} value={String(card[key])} />
            ) : null,
          )}
        </Shell>
      );
    case 'pause':
      return (
        <Shell title="Paused">
          <Row label="Until" value={str(card.paused_until) || 'resumed manually'} />
        </Shell>
      );
    case 'resume':
      return (
        <Shell title="Resumed">
          <Text style={[typography.body, { color: mutedText }]}>Everything runs again.</Text>
        </Shell>
      );
    case 'findings':
      return <FindingsCard card={card} />;
    case 'mission':
    case 'mission_list':
      return (
        <Shell title="Missions">
          {arr(card.missions).slice(0, 10).map((item, i) => {
            const m = obj(item);
            return <Row key={`${i}-${str(m.id)}`} label={str(m.status) || 'mission'} value={str(m.goal) || str(m.title) || 'Mission'} />;
          })}
          <Button title="Open missions" variant="secondary" onPress={() => openNative('/more/missions')} />
        </Shell>
      );
    case 'goal_confirm':
      return <GoalConfirm card={card} busy={busy} onConfirm={onConfirm} onCancel={onCancel} />;
    case 'schedule_confirm':
    case 'schedule_pick':
      return (
        <Shell title="Schedule">
          {str(card.cron) ? <Row label="When" value={str(card.cron)} /> : null}
          <Button title="Open schedules" variant="secondary" onPress={() => openNative('/more/schedules')} />
        </Shell>
      );
    case 'publish_confirm':
      return (
        <Shell title="Publish">
          <Button title="Open pages" variant="secondary" onPress={() => openNative('/more/pages')} />
        </Shell>
      );
    default:
      return null;
  }
}

function FindingsCard({ card }: { card: CommandCardData }) {
  const { colors } = useTheme();
  const items = arr(card.findings).flatMap((f) => {
    const text = typeof f === 'string' ? f : str(obj(f).text) || str(obj(f).title);
    return text ? [text] : [];
  });
  return (
    <Shell title="Findings">
      {items.length === 0 ? (
        <Text style={[typography.body, { color: colors.mutedText }]}>Nothing to report.</Text>
      ) : (
        items.slice(0, 20).map((text, i) => (
          <Text key={`${i}-${text.slice(0, 16)}`} style={[typography.body, { color: colors.text }]}>
            {`• ${text}`}
          </Text>
        ))
      )}
    </Shell>
  );
}

/** Start a mission: budget, deadline and run cap, then Start mission. Mirrors the web's GoalConfirmCard. */
function GoalConfirm({
  card,
  busy,
  onConfirm,
  onCancel,
}: {
  card: CommandCardData;
  busy: boolean;
  onConfirm?: (confirm: Record<string, unknown>) => void;
  onCancel?: () => void;
}) {
  const { colors, spacing: s, radius: r } = useTheme();
  const [budget, setBudget] = useState(String(typeof card.budget_inr === 'number' ? card.budget_inr : 500));
  const [deadline, setDeadline] = useState('7');
  const [maxRuns, setMaxRuns] = useState('20');
  const number = (value: string, fallback: number, min: number, max: number) => {
    const n = parseInt(value.replace(/[^0-9]/g, ''), 10);
    return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
  };
  const field = (label: string, value: string, set: (v: string) => void) => (
    <View style={{ gap: s.xs, flex: 1 }}>
      <Text style={[typography.caption, { color: colors.mutedText }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={set}
        keyboardType="number-pad"
        accessibilityLabel={label}
        style={[styles.input, { color: colors.text, backgroundColor: colors.inputBackground, borderColor: colors.border, borderRadius: r.md, fontFamily: fontFamily.regular }]}
      />
    </View>
  );
  return (
    <Shell title={str(card.goal) || 'Start a mission'}>
      <View style={{ flexDirection: 'row', gap: s.sm }}>
        {field('Budget (₹)', budget, setBudget)}
        {field('Deadline (days)', deadline, setDeadline)}
        {field('Max runs', maxRuns, setMaxRuns)}
      </View>
      <View style={{ flexDirection: 'row', gap: s.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            title="Start mission"
            loading={busy}
            onPress={() =>
              onConfirm?.({
                budget_inr: number(budget, 500, 1, 10_000_000),
                deadline_days: number(deadline, 7, 1, 90),
                max_runs: number(maxRuns, 20, 1, 100),
              })
            }
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Cancel" variant="secondary" onPress={() => onCancel?.()} />
        </View>
      </View>
    </Shell>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, padding: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
  input: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, minHeight: 44 },
});
