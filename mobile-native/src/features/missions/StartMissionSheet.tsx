import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button } from '../../components/Button';
import { ErrorText } from '../../components/ErrorText';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { messageOf } from '../agents/format';
import { useAgents } from '../agents/queries';
import { success } from '../../lib/haptics';
import { pressedOpacity, radius, spacing, typography, useTheme } from '../../theme';
import { useCreateMission } from './queries';
import type { MissionCreateInput } from './types';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/** Start a mission: the agent, the goal, and the limits that stop it. Same fields and defaults as the web's /goal confirm card. */
export function StartMissionSheet({ visible, onClose }: Props) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Start this mission?">
      {visible ? <StartForm onDone={onClose} /> : null}
    </Sheet>
  );
}

function clamp(text: string, lo: number, hi: number, fallback: number): number {
  const n = parseInt(text || '0', 10);
  if (!Number.isFinite(n) || n === 0) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function digits(text: string): string {
  return text.replace(/[^0-9]/g, '');
}

function StartForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const agents = useAgents();
  const create = useCreateMission();
  const [agentId, setAgentId] = useState<number | null>(null);
  const [goal, setGoal] = useState('');
  const [budget, setBudget] = useState('500');
  const [deadline, setDeadline] = useState('7');
  const [maxRuns, setMaxRuns] = useState('20');

  const visibleAgents = (agents.data ?? []).filter((a) => a.status !== 'archived');
  const ready = agentId != null && goal.trim().length > 0 && clamp(budget, 1, Number.MAX_SAFE_INTEGER, 0) > 0;

  const start = () => {
    if (!ready || agentId == null) return;
    const input: MissionCreateInput = {
      goal: goal.trim(),
      agent_id: agentId,
      budget_inr: clamp(budget, 1, Number.MAX_SAFE_INTEGER, 1),
      deadline_days: clamp(deadline, 1, 90, 7),
      max_runs: clamp(maxRuns, 1, 100, 20),
    };
    create.mutate(input, {
      onSuccess: (created) => {
        success();
        onDone();
        router.push(`/more/missions/${created.mission_id}`);
      },
    });
  };

  return (
    <ScrollView style={{ maxHeight: height * 0.7 }} contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.md }} keyboardShouldPersistTaps="handled">
      <Text style={[typography.caption, { color: colors.mutedText }]}>Agent</Text>
      <View style={styles.agents}>
        {visibleAgents.length === 0 ? (
          <Text style={[typography.body, { color: colors.mutedText }]}>You have no agents yet. Make one first.</Text>
        ) : null}
        {visibleAgents.map((a) => {
          const on = agentId === a.id;
          return (
            <Pressable
              key={a.id}
              accessibilityRole="button"
              accessibilityLabel={`Agent ${a.name}`}
              accessibilityState={{ selected: on }}
              onPress={() => setAgentId(a.id)}
              style={({ pressed }) => [
                styles.agent,
                {
                  borderColor: on ? colors.primary : colors.border,
                  backgroundColor: on ? colors.primary : colors.surface,
                  opacity: pressed ? pressedOpacity : 1,
                },
              ]}
            >
              <Text style={[typography.label, { color: on ? colors.primaryText : colors.text }]}>{a.name}</Text>
            </Pressable>
          );
        })}
      </View>

      <TextField
        label="Goal"
        value={goal}
        onChangeText={setGoal}
        placeholder="What should it keep working towards?"
        multiline
        style={{ minHeight: 88, textAlignVertical: 'top' }}
      />

      <TextField
        label="Budget (₹, required)"
        value={budget}
        onChangeText={(text) => setBudget(digits(text))}
        keyboardType="number-pad"
      />

      <View style={styles.pair}>
        <View style={styles.half}>
          <TextField
            label="Deadline (days)"
            value={deadline}
            onChangeText={(text) => setDeadline(digits(text))}
            keyboardType="number-pad"
            maxLength={3}
          />
        </View>
        <View style={styles.half}>
          <TextField
            label="Max runs"
            value={maxRuns}
            onChangeText={(text) => setMaxRuns(digits(text))}
            keyboardType="number-pad"
            maxLength={3}
          />
        </View>
      </View>

      <Text style={[typography.caption, { color: colors.mutedText }]}>
        The budget and the limits stop the mission; it never spends past them.
      </Text>
      <ErrorText message={create.isError ? messageOf(create.error, 'The mission could not be started.') : null} />
      <Button title="Start mission" onPress={start} loading={create.isPending} disabled={!ready || create.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  agents: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  agent: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  pair: { flexDirection: 'row', gap: spacing.md },
  half: { flex: 1 },
});
