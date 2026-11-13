import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Switch } from '../../components/Switch';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorText } from '../../components/ErrorText';
import { Icon } from '../../components/Icon';
import { TextField } from '../../components/TextField';
import { Text } from '../../components/Text';
import { messageOf } from '../../features/agents/format';
import { ChoicePicker } from '../../features/explore/ChoicePicker';
import { success } from '../../lib/haptics';
import { pressedOpacity, radius, spacing, typography, useTheme } from '../../theme';
import { SUPERVISION_HELP, SUPERVISION_ORDER } from './format';
import { useCreateSuite, useUpdateSuite } from './queries';
import type { EvalSuite, SupervisionPolicy } from './types';

interface AgentOption {
  id: number;
  name: string;
}

interface Props {
  /** Absent for a new suite. */
  existing?: EvalSuite;
  agents: AgentOption[];
  /** Called with the saved suite. */
  onSaved: (suite: EvalSuite) => void;
}

/** The fields a suite is made of. Create and edit share it: the same validation on both. */
export function SuiteForm({ existing, agents, onSaved }: Props) {
  const { colors, spacing: s } = useTheme();
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [subagent, setSubagent] = useState<number | null>(existing?.subagent ?? (agents[0]?.id ?? null));
  const [supervision, setSupervision] = useState<SupervisionPolicy>(existing?.supervision ?? 'disagreement');
  const [samplePercent, setSamplePercent] = useState(String(existing?.sample_percent ?? 20));
  const [threshold, setThreshold] = useState(String(Math.round((existing?.pass_threshold ?? 0.8) * 100)));
  const [gated, setGated] = useState<'run' | 'block'>(existing?.gated_calls ?? 'run');
  const [picker, setPicker] = useState<'agent' | 'supervision' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useCreateSuite();
  const update = useUpdateSuite();
  const saving = create.isPending || update.isPending;
  const agentName = agents.find((a) => a.id === subagent)?.name ?? 'Choose when running';

  const submit = () => {
    const pct = Number(threshold);
    const sample = Number(samplePercent);
    if (!name.trim()) return setError('Give the suite a name.');
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return setError('The pass mark must be between 0 and 100.');
    if (supervision === 'sampled' && (!Number.isFinite(sample) || sample < 0 || sample > 100)) {
      return setError('The sample must be between 0 and 100 percent.');
    }
    setError(null);
    const body: Partial<EvalSuite> = {
      name: name.trim(),
      description: description.trim(),
      subagent,
      supervision,
      sample_percent: sample,
      pass_threshold: pct / 100,
      gated_calls: gated,
    };
    const done = (suite: EvalSuite) => {
      success();
      onSaved(suite);
    };
    const fail = (err: unknown) => setError(messageOf(err, 'Could not save the suite.'));
    if (existing) update.mutate({ id: existing.id, body }, { onSuccess: done, onError: fail });
    else create.mutate(body, { onSuccess: done, onError: fail });
  };

  return (
    <View style={{ gap: s.lg }}>
      <TextField label="Name" value={name} onChangeText={setName} placeholder="Refund policy answers" />
      <TextField
        label="Description"
        value={description}
        onChangeText={setDescription}
        multiline
        style={styles.multiline}
      />

      <View style={{ gap: s.xs }}>
        <Text style={[typography.label, { color: colors.text }]}>Agent</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Agent: ${agentName}. Change`}
          onPress={() => setPicker('agent')}
          style={({ pressed }) => [styles.picker, { borderColor: colors.border, backgroundColor: colors.inputBackground, borderRadius: radius.md, opacity: pressed ? pressedOpacity : 1 }]}
        >
          <Text style={[typography.body, styles.pickerText, { color: colors.text }]}>{agentName}</Text>
          <Icon name="chevron-down" size={18} color={colors.mutedText} />
        </Pressable>
      </View>

      <View style={{ gap: s.xs }}>
        <Text style={[typography.label, { color: colors.text }]}>What gets reviewed by a person</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Review policy: ${supervision}. Change`}
          onPress={() => setPicker('supervision')}
          style={({ pressed }) => [styles.picker, { borderColor: colors.border, backgroundColor: colors.inputBackground, borderRadius: radius.md, opacity: pressed ? pressedOpacity : 1 }]}
        >
          <Text style={[typography.body, styles.pickerText, { color: colors.text }]}>{supervision}</Text>
          <Icon name="chevron-down" size={18} color={colors.mutedText} />
        </Pressable>
        <Text style={[typography.caption, { color: colors.mutedText }]}>{SUPERVISION_HELP[supervision]}</Text>
      </View>

      {supervision === 'sampled' ? (
        <TextField
          label="Sample percent"
          value={samplePercent}
          onChangeText={(t) => setSamplePercent(t.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
        />
      ) : null}

      <TextField
        label="Passes at (percent of cases)"
        value={threshold}
        onChangeText={(t) => setThreshold(t.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
      />

      <Card>
        <View style={styles.row}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[typography.label, { color: colors.text }]}>Calls needing approval</Text>
            <Text style={[typography.caption, { color: colors.mutedText }]}>
              An eval never waits for a person. Record and run lets the call happen; record and block declines it. Either way it is recorded.
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: s.xs }}>
            <Text style={[typography.caption, { color: colors.mutedText }]}>{gated === 'run' ? 'Record and run' : 'Record and block'}</Text>
            <Switch
              accessibilityLabel="Block calls needing approval"
              accessibilityRole="switch"
              value={gated === 'block'}
              onValueChange={(on) => setGated(on ? 'block' : 'run')}
              trackColor={{ false: colors.border, true: colors.primary }}

            />
          </View>
        </View>
      </Card>

      <ErrorText message={error} />
      <Button title={existing ? 'Save suite' : 'Create suite'} onPress={submit} disabled={!name.trim() || saving} loading={saving} />

      <ChoicePicker<number>
        visible={picker === 'agent'}
        title="Agent"
        value={subagent}
        options={agents.map((a) => ({ value: a.id, label: a.name }))}
        onSelect={(id) => setSubagent(id)}
        onClose={() => setPicker(null)}
      />
      <ChoicePicker<SupervisionPolicy>
        visible={picker === 'supervision'}
        title="Review policy"
        value={supervision}
        options={SUPERVISION_ORDER.map((p) => ({ value: p, label: p, hint: SUPERVISION_HELP[p] }))}
        onSelect={setSupervision}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  picker: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pickerText: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
