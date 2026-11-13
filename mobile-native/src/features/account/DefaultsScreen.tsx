import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';

import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { ErrorText } from '../../components/ErrorText';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { success } from '../../lib/haptics';
import { fontFamily, fontSize, pressedOpacity, radius, spacing, typography, useTheme } from '../../theme';
import { errorMessage } from '../settings/errors';
import { Notice } from '../settings/Notice';
import { PickerSheet, type PickerOption } from '../settings/Picker';
import { PickerRow } from '../settings/PickerRow';
import { AUTONOMY_OPTIONS } from './format';
import { DEFAULT_EFFORT, DEFAULT_MODEL, DEFAULT_PROVIDER, EFFORT_HINTS, EFFORT_LABELS, effortLevelsFor, nearestEffort } from './models';
import { useAccountProfile, useAIModels, useUpdateAccountProfile } from './queries';
import type { DefaultAutonomy } from './types';

const TEMP_MIN = 0;
const TEMP_MAX = 2;
const TEMP_STEP = 0.1;

type Sheet = 'provider' | 'model' | 'effort' | 'mode' | null;

/**
 * The provider, model, reasoning effort and default mode a new chat starts
 * with, and the temperature a new agent starts at. Same choices and words as
 * the web's General settings.
 */
export function DefaultsScreen() {
  const { colors } = useTheme();
  const profile = useAccountProfile();
  const catalogue = useAIModels();
  const update = useUpdateAccountProfile();

  // Drafts: null means "not changed yet", so the saved value shows.
  const [provider, setProvider] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [autonomy, setAutonomy] = useState<DefaultAutonomy | null>(null);
  const [temperature, setTemperature] = useState<number | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (profile.isPending || catalogue.isPending) return <LoadingState text="Loading your defaults" />;
  if (profile.isError || !profile.data || catalogue.isError || !catalogue.data) {
    return (
      <ErrorState
        message="Could not load your defaults. Check your connection and try again."
        onRetry={() => {
          void profile.refetch();
          void catalogue.refetch();
        }}
      />
    );
  }

  const p = profile.data;
  const providers = catalogue.data.providers;
  const savedProvider = p.llm_provider || DEFAULT_PROVIDER;
  const savedModel = p.llm_model || DEFAULT_MODEL;
  // `??` not `||`: '' is a real choice here, the model's own default.
  const savedEffort = p.llm_effort ?? DEFAULT_EFFORT;
  const savedAutonomy = (p.default_autonomy || 'ask') as DefaultAutonomy;
  const savedTemperature = p.default_temperature ?? 0.7;

  const curProvider = provider ?? savedProvider;
  const curModel = model ?? savedModel;
  const curEffort = effort ?? savedEffort;
  const curAutonomy = autonomy ?? savedAutonomy;
  const curTemperature = temperature ?? savedTemperature;

  const activeProvider = providers.find((x) => x.slug === curProvider);
  const models = activeProvider?.models ?? [];
  const levels = effortLevelsFor(providers, curProvider, curModel);
  // What the saved level would actually run at on this model, by the server's rule.
  const effective = levels.length ? nearestEffort(curEffort, levels) : '';
  const dirty =
    curProvider !== savedProvider ||
    curModel !== savedModel ||
    curEffort !== savedEffort ||
    curAutonomy !== savedAutonomy ||
    Math.abs(curTemperature - savedTemperature) > 1e-9;

  const providerOptions: PickerOption<string>[] = providers.map((x) => ({ value: x.slug, label: x.name, detail: x.description }));
  const modelOptions: PickerOption<string>[] = models.map((m) => ({
    value: m.value,
    label: m.is_free ? `${m.name} · free` : m.name,
    detail: m.available === false ? 'Needs a key for this provider' : m.description,
  }));
  const effortOptions: PickerOption<string>[] = [
    { value: '', label: EFFORT_LABELS[''], detail: EFFORT_HINTS[''] },
    ...levels.map((level) => ({ value: level, label: EFFORT_LABELS[level] ?? level, detail: EFFORT_HINTS[level] })),
  ];

  function discard() {
    setProvider(null);
    setModel(null);
    setEffort(null);
    setAutonomy(null);
    setTemperature(null);
    setError(null);
  }

  function save() {
    setError(null);
    setNotice(null);
    update.mutate(
      {
        llm_provider: curProvider,
        llm_model: curModel,
        llm_effort: curEffort,
        default_autonomy: curAutonomy,
        default_temperature: Number(curTemperature.toFixed(1)),
      },
      {
        onSuccess: () => {
          discard();
          success();
          setNotice('Settings saved');
        },
        onError: (err) => setError(errorMessage(err, 'Could not save settings')),
      },
    );
  }

  const stepTemperature = (delta: number) => {
    const next = Math.min(TEMP_MAX, Math.max(TEMP_MIN, Math.round((curTemperature + delta) * 10) / 10));
    setTemperature(next);
  };

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: 'Default model & mode' }} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.xxl }}>
        <Notice message={notice} tone="success" />

        <Section>
          <PickerRow
            label="Default AI provider"
            value={activeProvider?.name ?? ''}
            placeholder="Choose a provider"
            onPress={() => setSheet('provider')}
          />
          <PickerRow
            label="Default AI model"
            value={models.find((m) => m.value === curModel)?.name ?? curModel}
            placeholder="Choose a model"
            onPress={() => setSheet('model')}
          />
          <PickerRow
            label="Reasoning effort"
            value={levels.length ? (EFFORT_LABELS[effective] ?? effective) : ''}
            placeholder="Not supported by this model"
            disabled={levels.length === 0}
            onPress={() => setSheet('effort')}
          />
        </Section>
        <Text style={[typography.caption, { color: colors.mutedText, marginTop: -spacing.lg }]}>
          Who serves your AI features, the primary model they use, and how hard it thinks before answering.
        </Text>

        <Section>
          <PickerRow
            label="Default mode for new chats"
            value={AUTONOMY_OPTIONS.find((o) => o.value === curAutonomy)?.label ?? ''}
            placeholder="Ask before changes"
            onPress={() => setSheet('mode')}
          />
        </Section>
        <Text style={[typography.caption, { color: colors.mutedText, marginTop: -spacing.lg }]}>
          Plan only reads · Ask before changes asks for side effects · Ask before irreversible lets reversible work through.
        </Text>

        <Section>
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            <View style={{ gap: 2 }}>
              <Text style={typography.bodyStrong}>Default temperature for new agents</Text>
              <Text style={[typography.caption, { color: colors.mutedText }]}>
                Low is exact and repeatable; high is more varied. Each agent can override it.
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.md }}>
              <Stepper label="Lower temperature" glyph="−" onPress={() => stepTemperature(-TEMP_STEP)} disabled={curTemperature <= TEMP_MIN} />
              <Text
                accessibilityLabel={`Default temperature ${curTemperature.toFixed(1)}`}
                style={{ minWidth: 40, textAlign: 'center', color: colors.text, fontSize: fontSize.lg, fontFamily: fontFamily.medium }}
              >
                {curTemperature.toFixed(1)}
              </Text>
              <Stepper label="Higher temperature" glyph="+" onPress={() => stepTemperature(TEMP_STEP)} disabled={curTemperature >= TEMP_MAX} />
            </View>
          </View>
        </Section>

        <ErrorText message={error} />

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button title="Discard changes" variant="secondary" disabled={!dirty || update.isPending} onPress={discard} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Save Changes" loading={update.isPending} disabled={!dirty || update.isPending} onPress={save} />
          </View>
        </View>
      </ScrollView>

      <PickerSheet
        visible={sheet === 'provider'}
        title="Default AI provider"
        options={providerOptions}
        value={curProvider}
        onPick={(slug) => {
          // Changing provider invalidates the model, so both move together.
          setProvider(slug);
          setModel(providers.find((x) => x.slug === slug)?.models[0]?.value ?? '');
        }}
        onClose={() => setSheet(null)}
      />
      <PickerSheet
        visible={sheet === 'model'}
        title="Default AI model"
        options={modelOptions}
        value={curModel}
        searchable={models.length > 8}
        onPick={setModel}
        onClose={() => setSheet(null)}
      />
      <PickerSheet
        visible={sheet === 'effort'}
        title="Reasoning effort"
        options={effortOptions}
        value={curEffort}
        onPick={setEffort}
        onClose={() => setSheet(null)}
      />
      <PickerSheet
        visible={sheet === 'mode'}
        title="Default mode for new chats"
        options={AUTONOMY_OPTIONS.map((o) => ({ value: o.value, label: o.label, detail: o.detail }))}
        value={curAutonomy}
        onPick={(v) => setAutonomy(v as DefaultAutonomy)}
        onClose={() => setSheet(null)}
      />
    </Screen>
  );
}

function Stepper({ label, glyph, onPress, disabled }: { label: string; glyph: string; onPress: () => void; disabled: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.borderStrong,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : pressed ? pressedOpacity : 1,
      })}
    >
      <Text style={{ color: colors.text, fontSize: fontSize.lg, fontFamily: fontFamily.medium }}>{glyph}</Text>
    </Pressable>
  );
}
