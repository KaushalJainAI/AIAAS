/**
 * How a run behaves: autonomy, limits and spend, the shape of the answer, its
 * schedule, and how much of a long run's history it keeps.
 */
import { useState } from 'react';
import { Pressable } from 'react-native';
import { router } from 'expo-router';

import { Text } from '../../../components/Text';
import { pressedOpacity, spacing, typography, useTheme } from '../../../theme';
import { AUTONOMY_COPY, AUTONOMY_LEVELS, CONTRACT_COPY, OUTPUT_CONTRACTS, RUN_LIMIT_MAX_MINUTES, RUN_LIMIT_MIN_MINUTES, RUN_LIMIT_PRESETS_MINUTES, FANOUT_CHOICES } from '../config';
import { runLimitMinutes, runLimitSeconds } from '../edits';
import { summaryChoice } from '../payload';
import { useAgentSchedules } from '../queries';
import type { AgentConfig, Autonomy, OutputContract } from '../types';
import { BuilderScreen, type Builder } from './BuilderScreen';
import { Chips, ChoiceList, Field, Note, Notice, Panel, PickerRow, PickerSheet, Stepper, SwitchRow, TextBox } from '../ui';

/* ---------- autonomy ---------- */

export function AutonomyScreen({ id }: { id: string }) {
  return <BuilderScreen id={id} title="Autonomy" render={(b, cfg) => <AutonomyForm b={b} cfg={cfg} />} />;
}

export function AutonomyForm({ b, cfg }: { b: Builder; cfg: AgentConfig }) {
  const { colors } = useTheme();
  return (
    <>
      <Panel>
        <Field label="How much it does without asking" error={b.errors.autonomy}>
          <ChoiceList<Autonomy>
            value={cfg.autonomy}
            onChange={(v) => b.set('autonomy', v)}
            options={AUTONOMY_LEVELS.map((v) => ({ value: v, label: AUTONOMY_COPY[v].label, hint: AUTONOMY_COPY[v].hint }))}
          />
        </Field>
      </Panel>
      <Note>
        Sandboxed code has no network access. Web search and page reading go through us and are logged; the sandbox
        itself cannot dial out.
      </Note>
      <Text style={[typography.caption, { color: colors.mutedText }]}>
        Your own tool settings under Tool rules still win over this level.
      </Text>
    </>
  );
}

/* ---------- limits and spend ---------- */

export function GuardrailsScreen({ id }: { id: string }) {
  return <BuilderScreen id={id} title="Limits and spend" render={(b, cfg) => <GuardrailsForm b={b} cfg={cfg} />} />;
}

export function GuardrailsForm({ b, cfg }: { b: Builder; cfg: AgentConfig }) {
  const minutes = runLimitMinutes(cfg.maxRunSeconds);
  return (
    <>
      <Panel>
        <SwitchRow
          label="Can run automatically"
          hint="Needed for schedules and when another agent calls it."
          value={cfg.allowUnattended}
          onChange={(v) => b.set('allowUnattended', v)}
        />
      </Panel>
      <Panel>
        <Stepper
          label="Time limit"
          hint="per run"
          value={minutes}
          min={RUN_LIMIT_MIN_MINUTES}
          max={RUN_LIMIT_MAX_MINUTES}
          step={1}
          format={(v) => `${v} min`}
          onChange={(v) => b.set('maxRunSeconds', runLimitSeconds(v))}
        />
        <Chips<string>
          options={RUN_LIMIT_PRESETS_MINUTES.map((m) => ({ value: String(m), label: `${m} min` }))}
          value={RUN_LIMIT_PRESETS_MINUTES.includes(minutes) ? String(minutes) : ''}
          onChange={(v) => {
            if (v) b.set('maxRunSeconds', runLimitSeconds(Number(v)));
          }}
        />
        <Note>
          Near the limit the agent stops calling tools and answers with what it has, so a run that runs long still
          returns something. Work it delegates shares this budget.
        </Note>
        {b.errors.maxRunSeconds ? <Notice text={b.errors.maxRunSeconds} /> : null}
      </Panel>
      <Panel>
        <Field label="Spend cap" hint="₹ per month" error={b.errors.spendCapRupees}>
          <TextBox
            accessibilityLabel="Spend cap in rupees per month"
            keyboardType="number-pad"
            value={String(cfg.spendCapRupees)}
            onChangeText={(t) => b.set('spendCapRupees', Number(t.replace(/[^0-9]/g, '')) || 0)}
          />
        </Field>
      </Panel>
      <Panel>
        <SwitchRow
          label="Notify me when it stops to ask"
          hint={
            cfg.notifyOnHitl
              ? 'Pings you when it pauses, then again after an hour and a day.'
              : 'No pings for this agent. It still waits in your Inbox and in the daily summary.'
          }
          value={cfg.notifyOnHitl}
          onChange={(v) => b.set('notifyOnHitl', v)}
        />
      </Panel>
    </>
  );
}

/* ---------- result shape ---------- */

export function OutputScreen({ id }: { id: string }) {
  return <BuilderScreen id={id} title="Result shape" render={(b, cfg) => <OutputForm b={b} cfg={cfg} />} />;
}

export function OutputForm({ b, cfg }: { b: Builder; cfg: AgentConfig }) {
  return (
    <>
      <Panel>
        <Field label="What it returns" error={b.errors.outputContract}>
          <ChoiceList<OutputContract>
            value={cfg.outputContract}
            onChange={(v) => b.set('outputContract', v)}
            options={OUTPUT_CONTRACTS.map((v) => ({ value: v, label: CONTRACT_COPY[v].label, hint: CONTRACT_COPY[v].hint }))}
          />
        </Field>
        <Note>A shape other than prose is checked on the way out: an answer that does not fit is reported as a failure, not quietly reshaped.</Note>
      </Panel>
      <Panel>
        <Field label="Fan-out width" hint="when another agent hands it a list" error={b.errors.fanoutParallel}>
          <Chips<string>
            options={FANOUT_CHOICES.map((n) => ({ value: n === null ? 'one' : String(n), label: n === null ? 'One at a time' : `${n} at once` }))}
            value={cfg.fanoutParallel === null ? 'one' : String(cfg.fanoutParallel)}
            onChange={(v) => b.set('fanoutParallel', v === 'one' || v === '' ? null : Number(v))}
          />
        </Field>
      </Panel>
    </>
  );
}

/* ---------- schedule ---------- */

export function ScheduleScreen({ id }: { id: string }) {
  return <BuilderScreen id={id} title="Schedule" render={(b, cfg) => <ScheduleForm b={b} cfg={cfg} />} />;
}

export function ScheduleForm({ b }: { b: Builder; cfg: AgentConfig }) {
  const { colors } = useTheme();
  const triggers = useAgentSchedules(b.agentId);
  const schedules = (triggers.data ?? []).filter((t) => t.mode === 'schedule');
  const openSchedules = () => router.push('/more/schedules');

  return (
    <>
      <Panel>
        {b.isNew || b.agentId == null ? (
          <Note>Save the agent first, then add a schedule.</Note>
        ) : triggers.isPending ? (
          <Note>Loading schedules…</Note>
        ) : schedules.length === 0 ? (
          <Note>No schedules yet. This agent runs when you ask it to.</Note>
        ) : (
          schedules.map((t) => (
            <Text key={t.id} style={[typography.body, { color: colors.text }]}>
              {t.description || t.name || 'Schedule'}
            </Text>
          ))
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Manage schedules"
          onPress={openSchedules}
          style={({ pressed }) => ({
            minHeight: 44,
            justifyContent: 'center',
            marginTop: spacing.sm,
            opacity: pressed ? pressedOpacity : 1,
          })}
        >
          <Text style={[typography.label, { color: colors.primary }]}>Manage schedules</Text>
        </Pressable>
        <Note>Schedules are made and edited on the Schedules page, so one agent can have several.</Note>
      </Panel>
    </>
  );
}

/* ---------- context ---------- */

export function ContextScreen({ id }: { id: string }) {
  return <BuilderScreen id={id} title="Context" render={(b, cfg) => <ContextForm b={b} cfg={cfg} />} />;
}

export function ContextForm({ b, cfg }: { b: Builder; cfg: AgentConfig }) {
  const [open, setOpen] = useState(false);
  const models = b.providers.flatMap((p) =>
    (p.models ?? [])
      .filter((m) => m.available !== false || m.value === cfg.summaryModel)
      .map((m) => ({
        value: m.value,
        label: `${p.name} · ${m.name}${m.is_free ? ' · free' : ''}${m.available === false ? ' · no key' : ''}`,
      })),
  );
  const chosen = models.find((m) => m.value === cfg.summaryModel)?.label;

  return (
    <>
      <Note>
        A long run carries its whole transcript into every step, so eventually it outgrows the model’s context window.
        These decide what gets cut and whether it can be read back. Nothing happens until a run nears its limit.
      </Note>
      <Panel>
        <SwitchRow
          label="Auto-compact history"
          hint="Replace older tool results with a short record. Costs nothing, and what each step did stays visible."
          value={cfg.compaction}
          onChange={(v) => b.set('compaction', v)}
        />
        <SwitchRow
          label="Smart summarization"
          hint="When compaction is not enough, fold the oldest steps into one running summary. Costs a small model call each time."
          value={cfg.recursiveContext}
          onChange={(v) => b.set('recursiveContext', v)}
        />
        {cfg.recursiveContext ? (
          <PickerRow
            label="Summarizing model"
            value={chosen ?? 'Platform default (recommended)'}
            error={b.errors.summaryModel}
            hint="platform key"
            onPress={() => setOpen(true)}
          />
        ) : null}
        <SwitchRow
          label="Save and recall"
          hint="Store whatever is cut, so the agent can search it back mid-run. Off means removed text is gone for good."
          value={cfg.indexing}
          onChange={(v) => b.set('indexing', v)}
        />
      </Panel>
      <Panel>
        <SwitchRow
          label="Environment"
          hint="Current time and place, for anything schedule- or locale-aware."
          value={cfg.useEnvironment}
          onChange={(v) => b.set('useEnvironment', v)}
        />
      </Panel>
      <PickerSheet
        visible={open}
        title="Summarizing model"
        searchable
        value={cfg.summaryModel}
        options={[{ value: '', label: 'Platform default (recommended)' }, ...models]}
        onClose={() => setOpen(false)}
        onSelect={(value) => {
          const choice = summaryChoice(value, b.providers);
          b.setCfg({ ...cfg, ...choice });
        }}
      />
    </>
  );
}
