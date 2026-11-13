import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorText } from '../../components/ErrorText';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import type { Agent } from '../agents/types';
import { messageOf } from '../agents/format';
import { success } from '../../lib/haptics';
import { pressedOpacity, radius, spacing, typography, useTheme } from '../../theme';
import { cronOf, datesValid, draftFromTrigger, emptyDraft, type ScheduleDraft } from './draft';
import { fromLocalText } from './format';
import { useAgentFix, useCreateTrigger, useUpdateTrigger } from './queries';
import { ScheduleEditor } from './ScheduleEditor';
import type { Trigger, TriggerMode } from './types';

interface Props {
  visible: boolean;
  onClose: () => void;
  mode: TriggerMode;
  /** null when creating. */
  trigger: Trigger | null;
  agents: Agent[];
}

/**
 * Create or edit one schedule or webhook. Creating starts with a choice of
 * agent (an agent may have as many schedules as it needs); editing has the agent
 * already. The form mounts each time the sheet opens, so it starts fresh.
 */
export function ScheduleSheet({ visible, onClose, mode, trigger, agents }: Props) {
  const title = trigger
    ? mode === 'webhook' ? 'Edit webhook' : 'Edit schedule'
    : mode === 'webhook' ? 'New webhook' : 'New schedule';
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {visible ? <ScheduleForm mode={mode} trigger={trigger} agents={agents} onDone={onClose} /> : null}
    </Sheet>
  );
}

function ScheduleForm({
  mode,
  trigger,
  agents,
  onDone,
}: Omit<Props, 'visible' | 'onClose'> & { onDone: () => void }) {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const isWebhook = mode === 'webhook';
  const [agentId, setAgentId] = useState<number | null>(trigger ? trigger.subagent : null);
  const [draft, setDraft] = useState<ScheduleDraft>(() =>
    trigger && !isWebhook ? draftFromTrigger(trigger) : emptyDraft(),
  );
  const [hookName, setHookName] = useState(trigger?.name ?? '');
  const [hookGoal, setHookGoal] = useState(trigger?.goal ?? '');
  const [allowed, setAllowed] = useState<boolean | null>(null);

  const create = useCreateTrigger();
  const update = useUpdateTrigger(trigger?.id ?? 0);
  const allow = useAgentFix();

  const agent = agents.find((a) => a.id === agentId) ?? null;
  const agentName = trigger?.agent_name ?? agent?.name ?? '';
  const unattended = allowed ?? (trigger ? trigger.agent_allows_unattended : (agent?.allowUnattended ?? false));
  const hasPrompt = trigger ? trigger.agent_has_prompt : Boolean((agent?.brief ?? '').trim());
  const visibleAgents = agents.filter((a) => a.status !== 'archived');

  const incomplete = isWebhook
    ? !hasPrompt && !hookGoal.trim()
    : !cronOf(draft).trim() || !datesValid(draft);

  const busy = create.isPending || update.isPending;
  const failure = create.isError ? create.error : update.isError ? update.error : null;

  const save = () => {
    if (!agentId && !trigger) return;
    const done = {
      onSuccess: () => {
        success();
        onDone();
      },
    };
    if (trigger) {
      const patch = isWebhook
        ? { name: hookName, goal: hookGoal }
        : {
            cron: cronOf(draft),
            timezone: draft.timezone,
            name: draft.name,
            goal: draft.goal,
            overlap: draft.overlap,
            starts_at: fromLocalText(draft.startsText) ?? null,
            ends_at: fromLocalText(draft.endsText) ?? null,
          };
      update.mutate(patch, done);
      return;
    }
    const payload = isWebhook
      ? { subagent: agentId!, mode: 'webhook' as const, name: hookName, goal: hookGoal }
      : {
          subagent: agentId!,
          mode: 'schedule' as const,
          cron: cronOf(draft),
          timezone: draft.timezone,
          name: draft.name,
          goal: draft.goal,
          overlap: draft.overlap,
          starts_at: fromLocalText(draft.startsText) ?? null,
          ends_at: fromLocalText(draft.endsText) ?? null,
        };
    create.mutate(payload, done);
  };

  const onAllow = () => {
    const id = trigger ? trigger.subagent : agentId;
    if (id == null) return;
    allow.mutate({ agentId: id, patch: { allowUnattended: true } }, { onSuccess: () => setAllowed(true) });
  };

  // Creating: pick the agent first. The pick is the first step, not a second dialog.
  if (!trigger && agentId == null) {
    return (
      <ScrollView style={{ maxHeight: height * 0.7 }} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}>
        <Text style={[typography.body, { color: colors.text }]}>
          {isWebhook ? 'Which agent should the URL start?' : 'Which agent should run on a schedule?'}
        </Text>
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          {`An agent can have as many ${isWebhook ? 'webhooks' : 'schedules'} as you need.`}
        </Text>
        {visibleAgents.length === 0 ? (
          <Text style={[typography.body, { color: colors.mutedText }]}>You have no agents yet. Make one first.</Text>
        ) : null}
        {visibleAgents.map((a) => (
          <Pressable
            key={a.id}
            accessibilityRole="button"
            accessibilityLabel={`Choose ${a.name}`}
            onPress={() => setAgentId(a.id)}
            style={({ pressed }) => [styles.agentRow, { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? pressedOpacity : 1 }]}
          >
            <View style={styles.grow}>
              <Text style={[typography.label, { color: colors.text }]} numberOfLines={1}>{a.name}</Text>
              {a.description ? (
                <Text style={[typography.caption, { color: colors.mutedText }]} numberOfLines={2}>{a.description}</Text>
              ) : null}
            </View>
            <Icon name="chevron-forward" size={18} color={colors.mutedText} />
          </Pressable>
        ))}
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ maxHeight: height * 0.7 }} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.md }} keyboardShouldPersistTaps="handled">
      <View style={styles.agentLine}>
        <Text style={[typography.caption, { color: colors.mutedText }]}>Agent</Text>
        <Text style={[typography.label, styles.grow, { color: colors.text }]} numberOfLines={1}>{agentName}</Text>
        {!trigger ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Change agent" onPress={() => setAgentId(null)} style={styles.change}>
            <Text style={[typography.label, { color: colors.primary }]}>Change</Text>
          </Pressable>
        ) : null}
      </View>

      {isWebhook ? (
        <>
          {!unattended ? (
            <Card style={{ ...styles.warn, borderColor: colors.warning }}>
              <Text style={[typography.caption, { color: colors.warning }]}>
                This agent is not allowed to run with nobody watching, so every request to this URL will be refused.
              </Text>
              <Button title="Allow it" variant="secondary" onPress={onAllow} loading={allow.isPending} />
            </Card>
          ) : null}
          <TextField
            label="Name"
            value={hookName}
            onChangeText={setHookName}
            placeholder="Production alerts"
            maxLength={80}
          />
          <TextField
            label="What should the agent do?"
            value={hookGoal}
            onChangeText={setHookGoal}
            placeholder="Triage the incoming alert and post a summary to the on-call channel."
            multiline
            style={{ minHeight: 88, textAlignVertical: 'top' }}
          />
          <Card style={styles.note}>
            <Icon name="information-circle-outline" size={18} color={colors.mutedText} />
            <Text style={[typography.caption, styles.grow, { color: colors.mutedText }]}>
              The request body is added to this instruction as context, never as the instruction itself. Anyone who knows the URL can send a body, so a request can never tell the agent what to do. Bodies over 64 KB are refused.
            </Text>
          </Card>
          {!hasPrompt && !hookGoal.trim() ? (
            <Text style={[typography.caption, { color: colors.warning }]}>
              This agent has no description of its own, so this hook needs an instruction. Without one every request is refused.
            </Text>
          ) : null}
          {!trigger ? (
            <Text style={[typography.caption, { color: colors.mutedText }]}>
              The URL is generated when you save and shown on the card. It is the only credential, so anyone who has it can start a run.
            </Text>
          ) : null}
        </>
      ) : (
        <ScheduleEditor
          value={draft}
          onChange={setDraft}
          agentAllowsUnattended={unattended}
          onAllow={onAllow}
          allowing={allow.isPending}
          allowError={allow.isError ? messageOf(allow.error, 'Could not allow it.') : null}
        />
      )}

      <ErrorText message={failure ? messageOf(failure, 'Could not save this schedule.') : null} />
      <Button
        title={trigger ? 'Save' : isWebhook ? 'Create webhook' : 'Create schedule'}
        onPress={save}
        loading={busy}
        disabled={incomplete || busy}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  agentRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  agentLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  change: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  warn: { gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
});
