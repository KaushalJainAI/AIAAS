import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Switch } from '../../components/Switch';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorText } from '../../components/ErrorText';
import { Icon } from '../../components/Icon';
import { TextField } from '../../components/TextField';
import { Text } from '../../components/Text';
import { confirm } from '../../components/confirm';
import { messageOf } from '../../features/agents/format';
import { ChoicePicker } from '../../features/explore/ChoicePicker';
import { success, warning } from '../../lib/haptics';
import { pressedOpacity, radius, spacing, typography, useTheme } from '../../theme';
import { EMPTY_FORM, firstError, toForm, toPayload, type CaseForm as Form, type GraderRow } from './caseModel';
import { useCreateCase, useDeleteCase, useGraderCatalog, useUpdateCase } from './queries';
import type { EvalCase } from './types';

/**
 * Write or edit one case by hand. A case written here is the person's own and is
 * saved active. A case built for a test world is different: the judge set its expected
 * answer and checks and proved them against that world, so only the name, weight and
 * active switch can change.
 */
export function CaseForm({
  suiteId,
  existing,
  onDone,
}: {
  suiteId: number;
  existing?: EvalCase;
  onDone: () => void;
}) {
  const { colors, spacing: s } = useTheme();
  const [form, setForm] = useState<Form>(existing ? toForm(existing) : EMPTY_FORM);
  const [graderPick, setGraderPick] = useState<number | 'add' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fromWorld = existing?.world_version != null;
  const catalog = useGraderCatalog();
  const create = useCreateCase();
  const update = useUpdateCase();
  const remove = useDeleteCase();
  const busy = create.isPending || update.isPending || remove.isPending;

  const byType = new Map((catalog.data ?? []).map((g) => [g.type, g]));
  const weight = Number(form.weight);
  const canSave = form.goal.trim() !== '' && Number.isFinite(weight) && weight > 0 && !busy;

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setGrader = (i: number, row: GraderRow) => set('graders', form.graders.map((g, j) => (j === i ? row : g)));

  const save = () => {
    setError(null);
    const body = toPayload(form);
    const done = () => {
      success();
      onDone();
    };
    const fail = (err: unknown) => setError(firstError((err as { body?: unknown })?.body) ?? messageOf(err, 'Could not save the case.'));
    if (existing && fromWorld) {
      update.mutate({ caseId: existing.id, body: { name: body.name, weight: body.weight, is_active: body.is_active } }, { onSuccess: done, onError: fail });
    } else if (existing) {
      update.mutate({ caseId: existing.id, body }, { onSuccess: done, onError: fail });
    } else {
      create.mutate({ suiteId, body }, { onSuccess: done, onError: fail });
    }
  };

  const removeCase = async () => {
    if (!existing) return;
    const ok = await confirm({
      title: 'Delete this case?',
      message: 'Past sweeps keep their results for it. It just stops being run.',
      destructiveLabel: 'Delete',
    });
    if (!ok) return;
    warning();
    remove.mutate(existing.id, {
      onSuccess: onDone,
      onError: (err) => setError(messageOf(err, 'Could not delete the case.')),
    });
  };

  const pickedRow = typeof graderPick === 'number' ? form.graders[graderPick] : undefined;

  return (
    <View style={{ gap: s.lg }}>
      {fromWorld ? (
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          Built for test world v{existing?.world_version}. The judge set its expected answer and checks, so only the name,
          weight and active switch can change.
        </Text>
      ) : null}

      <TextField label="Name" value={form.name} onChangeText={(t) => set('name', t)} placeholder="Refund window" />
      <TextField
        label="Goal: what the agent is asked"
        value={form.goal}
        onChangeText={(t) => set('goal', t)}
        multiline
        editable={!fromWorld}
        style={styles.multiline}
        placeholder="A customer asks how long they have to return an item."
      />
      <TextField
        label="What a good answer looks like"
        value={form.reference}
        onChangeText={(t) => set('reference', t)}
        multiline
        editable={!fromWorld}
        style={styles.multiline}
        placeholder="States the 30-day window and links the returns page."
      />
      <Text style={[typography.caption, { color: colors.mutedText }]}>
        Optional. The LLM judge grades against it. The exact checks do not read it.
      </Text>

      <View style={{ gap: s.sm }}>
        <View style={styles.checksHead}>
          <Text style={[typography.label, { color: colors.text }]}>Checks</Text>
          {!fromWorld ? (
            <Button
              title="Add check"
              variant="secondary"
              onPress={() => setGraderPick('add')}
              disabled={!catalog.data?.length}
            />
          ) : null}
        </View>
        {form.graders.length === 0 ? (
          <Text style={[typography.caption, { color: colors.mutedText }]}>No checks: a person reviews every result of this case.</Text>
        ) : null}
        {form.graders.map((row, i) => {
          const entry = byType.get(row.type);
          const params = entry?.params ?? Object.keys(row.params);
          return (
            <Card key={i}>
              <View style={{ gap: s.sm }}>
                <View style={styles.checksHead}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Check ${row.type}. Change`}
                    disabled={fromWorld}
                    onPress={() => setGraderPick(i)}
                    style={({ pressed }) => [styles.picker, { borderColor: colors.border, backgroundColor: colors.inputBackground, borderRadius: radius.md, flex: 1, opacity: pressed ? pressedOpacity : 1 }]}
                  >
                    <Text style={[typography.body, styles.pickerText, { color: colors.text }]}>{row.type}</Text>
                    {!fromWorld ? <Icon name="chevron-down" size={18} color={colors.mutedText} /> : null}
                  </Pressable>
                  {!fromWorld ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Remove check"
                      onPress={() => set('graders', form.graders.filter((_, j) => j !== i))}
                      style={({ pressed }) => [styles.iconButton, { opacity: pressed ? pressedOpacity : 1 }]}
                    >
                      <Icon name="trash-outline" size={20} color={colors.danger} />
                    </Pressable>
                  ) : null}
                </View>
                {entry?.description ? (
                  <Text style={[typography.caption, { color: colors.mutedText }]}>
                    {entry.description}
                    {entry.calls_model ? ' · uses a model, so pair it with an exact check' : ''}
                  </Text>
                ) : null}
                {params.map((p) => (
                  <TextField
                    key={p}
                    label={`${p}${entry?.required.includes(p) ? ' *' : ''}`}
                    value={row.params[p] ?? ''}
                    editable={!fromWorld}
                    onChangeText={(t) => setGrader(i, { ...row, params: { ...row.params, [p]: t } })}
                  />
                ))}
              </View>
            </Card>
          );
        })}
      </View>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <TextField label="Weight" value={form.weight} onChangeText={(t) => set('weight', t)} keyboardType="decimal-pad" />
        </View>
        <View style={styles.activeWrap}>
          <Text style={[typography.label, { color: colors.text }]}>Active</Text>
          <Switch
            accessibilityLabel="Active. Included in sweeps"
            accessibilityRole="switch"
            value={form.isActive}
            onValueChange={(v) => set('isActive', v)}
            trackColor={{ false: colors.border, true: colors.primary }}

          />
        </View>
      </View>

      <ErrorText message={error} />
      <Button title={existing ? 'Save case' : 'Add case'} onPress={save} disabled={!canSave} loading={create.isPending || update.isPending} />
      {existing ? (
        <Button title="Delete case" variant="secondary" onPress={() => void removeCase()} disabled={busy} loading={remove.isPending} />
      ) : null}

      <ChoicePicker<string>
        visible={graderPick !== null}
        title={graderPick === 'add' ? 'Add a check' : 'Check'}
        value={graderPick === 'add' ? '' : (pickedRow?.type ?? '')}
        options={(catalog.data ?? []).map((g) => ({ value: g.type, label: g.type, hint: g.description }))}
        onSelect={(type) => {
          if (graderPick === 'add') {
            set('graders', [...form.graders, { type, params: {} }]);
          } else if (typeof graderPick === 'number') {
            setGrader(graderPick, { type, params: {} });
          }
        }}
        onClose={() => setGraderPick(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  checksHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
  iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  activeWrap: { alignItems: 'center', gap: spacing.xs, paddingBottom: spacing.sm },
});
