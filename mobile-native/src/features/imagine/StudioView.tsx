/**
 * Studio: pick a kind and a model, write the prompt, set the dials the model takes,
 * and generate. Below it, the creations. Mirrors better-n8n-frontend/src/pages/Imagine.tsx
 * (Studio view) and its state in hooks/useImagineStudio.ts.
 */
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';

import { ApiError } from '../../api/client';
import { Button } from '../../components/Button';
import { ErrorText } from '../../components/ErrorText';
import { Text } from '../../components/Text';
import { confirm } from '../../components/confirm';
import { messageOf } from '../agents/format';
import { success, warning } from '../../lib/haptics';
import { useRefresh } from '../../hooks/useRefresh';
import { SegmentedControl } from '../../components/SegmentedControl';
import { spacing, typography, useTheme } from '../../theme';
import { Chips, Field, Note, Notice, Panel, PickerRow, PickerSheet, Stepper, SwitchRow, TextBox } from '../builder/ui';
import { GenerationCard } from './GenerationCard';
import { EMPTY_CAPABILITIES } from './request';
import { useCreateGeneration, useGenerations, useImagineCapabilities, useRemoveGeneration } from './queries';
import { defaultModelFor, buildRequest, INITIAL_PARAMS, snapParams, type StudioParams } from './studio';
import { stylesFor } from './styles';
import type { MediaKind, ModelCapability } from './types';

const PLACEHOLDERS: Record<MediaKind, string> = {
  image: 'A neon-lit Tokyo street after rain, reflections on wet asphalt…',
  video: 'Slow aerial push over a misty pine forest at sunrise…',
  audio: 'Welcome to the future of media. Everything you imagine, generated on demand.',
};

const STARTERS: Record<MediaKind, string[]> = {
  image: [
    'A fox curled asleep in a birch forest, soft morning light',
    'Isometric cutaway of a cosy attic studio',
    'Matte black espresso machine on raw concrete',
  ],
  video: [
    'Drone skimming a turquoise coastline at golden hour',
    'Storm clouds rolling over a wheat field',
    'Ink diffusing through water, macro',
  ],
  audio: [
    'Calm narrator: "The results are in, and they are remarkable."',
    'Upbeat host: "Welcome back. Let us dive straight in."',
  ],
};

const FRAME_LABELS: Record<string, string> = { first_frame: 'Start frame', last_frame: 'End frame' };

const KIND_ITEMS: { key: MediaKind; label: string; count: number }[] = [
  { key: 'image', label: 'Image', count: 0 },
  { key: 'video', label: 'Video', count: 0 },
  { key: 'audio', label: 'Audio', count: 0 },
];

export function StudioView() {
  const { colors } = useTheme();
  const caps = useImagineCapabilities();
  const generations = useGenerations();
  const create = useCreateGeneration();
  const remove = useRemoveGeneration();
  const { refreshing, onRefresh } = useRefresh(async () => {
    await Promise.all([caps.refetch(), generations.refetch()]);
  });

  const [kind, setKind] = useState<MediaKind>('image');
  const [modelByKind, setModelByKind] = useState<Partial<Record<MediaKind, string>>>({});
  const [prompt, setPrompt] = useState('');
  const [params, setParams] = useState<StudioParams>(INITIAL_PARAMS);
  const [styleId, setStyleId] = useState('none');
  const [more, setMore] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snappedKey, setSnappedKey] = useState('');

  const catalogue = caps.data ?? EMPTY_CAPABILITIES;
  const pool = catalogue[kind];
  const chosen = modelByKind[kind];
  const modelId = chosen && pool.some((m) => m.id === chosen) ? chosen : defaultModelFor(catalogue, kind);
  const activeModel: ModelCapability | null = pool.find((m) => m.id === modelId) ?? null;
  const needsKey = caps.error instanceof ApiError && caps.error.status === 400;

  // Dials follow the model: when the model changes, the values it does not take are dropped.
  const key = `${kind}:${modelId}`;
  if (activeModel && snappedKey !== key) {
    setSnappedKey(key);
    setParams((prev) => snapParams(prev, activeModel, kind));
  }

  const style = stylesFor(kind).find((s) => s.id === styleId) ?? null;
  const canGenerate = prompt.trim().length > 0 && !!activeModel && !create.isPending && !needsKey;

  const patch = (next: Partial<StudioParams>) => setParams((prev) => ({ ...prev, ...next }));

  const generate = async () => {
    if (!activeModel) return;
    setError(null);
    try {
      const created = await create.mutateAsync(buildRequest({ kind, prompt, model: activeModel, params, style }));
      setPrompt('');
      if (created.status === 'failed') {
        warning();
        setError(created.error_message ?? 'Generation failed.');
      } else {
        success();
      }
    } catch (err) {
      warning();
      setError(messageOf(err, 'Generation failed.'));
    }
  };

  const askDelete = async (id: number) => {
    const ok = await confirm({
      title: 'Delete this creation?',
      message: 'It is removed from your list. This cannot be undone.',
      destructiveLabel: 'Delete',
    });
    if (!ok) return;
    warning();
    try {
      await remove.mutateAsync(id);
    } catch (err) {
      setError(messageOf(err, 'Could not delete that generation.'));
    }
  };

  const list = generations.data ?? [];
  const ratios = activeModel?.aspect_ratios ?? [];
  const sizes = activeModel?.resolutions ?? [];

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      contentContainerStyle={{ gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.xxl }}
    >
      <SegmentedControl<MediaKind>
        items={KIND_ITEMS}
        value={kind}
        onChange={(next) => {
          setKind(next);
          setError(null);
        }}
      />

      {needsKey ? (
        <Panel>
          <Notice text="Add an OpenRouter credential first. Imagine bills generations to it." tone="warning" />
          <Button title="Open credentials" variant="secondary" onPress={() => router.push('/more/credentials')} />
        </Panel>
      ) : null}
      {caps.isError && !needsKey ? <ErrorText message={messageOf(caps.error, 'Could not load the model catalogue.')} /> : null}

      <Panel>
        <PickerRow
          label="Model"
          value={activeModel?.name ?? ''}
          placeholder={caps.isPending ? 'Loading models…' : 'Choose a model'}
          hint={activeModel?.provider}
          onPress={() => setModelOpen(true)}
        />
        {activeModel?.description ? <Note>{activeModel.description}</Note> : null}
      </Panel>

      <Panel>
        <TextBox
          accessibilityLabel="Prompt"
          multiline
          value={prompt}
          onChangeText={setPrompt}
          placeholder={PLACEHOLDERS[kind]}
        />
        {!prompt.trim() ? <Chips<string> options={STARTERS[kind].map((s) => ({ value: s, label: s }))} value="" onChange={(v) => setPrompt(v)} /> : null}

        {kind !== 'audio' && ratios.length > 0 ? (
          <Field label="Ratio">
            <Chips<string> options={ratios.map((r) => ({ value: r, label: r }))} value={params.aspectRatio ?? ''} onChange={(v) => patch({ aspectRatio: v })} />
          </Field>
        ) : null}
        {kind !== 'audio' && sizes.length > 0 ? (
          <Field label={kind === 'video' ? 'Resolution' : 'Size'}>
            <Chips<string> options={sizes.map((r) => ({ value: r, label: r }))} value={params.resolution ?? ''} onChange={(v) => patch({ resolution: v })} />
          </Field>
        ) : null}
        {kind === 'video' && (activeModel?.durations?.length ?? 0) > 0 ? (
          <Field label="Length">
            <Chips<string>
              options={(activeModel?.durations ?? []).map((d) => ({ value: String(d), label: `${d}s` }))}
              value={params.duration ? String(params.duration) : ''}
              onChange={(v) => patch({ duration: Number(v) })}
            />
          </Field>
        ) : null}
        {kind === 'audio' && (activeModel?.voices?.length ?? 0) > 0 ? (
          <Field label="Voice">
            <Chips<string> options={(activeModel?.voices ?? []).map((v) => ({ value: v, label: v }))} value={params.voice ?? ''} onChange={(v) => patch({ voice: v })} />
          </Field>
        ) : null}

        {kind !== 'audio' && stylesFor(kind).length > 0 ? (
          <Field label="Style">
            <Chips<string> options={stylesFor(kind).map((s) => ({ value: s.id, label: s.name }))} value={styleId} onChange={(v) => setStyleId(v || 'none')} />
          </Field>
        ) : null}

        <Button
          title={more ? 'Fewer options' : 'More options'}
          variant="secondary"
          onPress={() => setMore((m) => !m)}
        />

        {more && activeModel ? <MoreOptions kind={kind} model={activeModel} params={params} onChange={patch} /> : null}

        {error ? <Notice text={error} /> : null}
        <Button title="Generate" onPress={() => void generate()} loading={create.isPending} disabled={!canGenerate} />
      </Panel>

      <View style={{ gap: spacing.sm }}>
        <Text accessibilityRole="header" style={[typography.heading, { color: colors.text }]}>Your creations</Text>
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          {list.length} {list.length === 1 ? 'result' : 'results'}
        </Text>
      </View>

      {generations.isPending ? <Note>Loading your creations…</Note> : null}
      {generations.isError ? <ErrorText message={messageOf(generations.error, 'Could not load your creations.')} /> : null}
      {generations.isSuccess && list.length === 0 ? (
        <Note>Nothing generated yet. Pick a model, describe what you want, and your results collect here.</Note>
      ) : null}
      {list.map((g) => (
        <GenerationCard
          key={g.id}
          generation={g}
          onDelete={(id) => void askDelete(id)}
          deleting={remove.isPending && remove.variables === g.id}
        />
      ))}

      <PickerSheet<string>
        visible={modelOpen}
        title="Model"
        searchable={pool.length > 8}
        value={modelId}
        emptyText="No models for this kind yet."
        options={[...pool]
          .sort((a, b) => Number(catalogue.recommended[kind]?.includes(b.id) ?? false) - Number(catalogue.recommended[kind]?.includes(a.id) ?? false))
          .map((m) => ({ value: m.id, label: m.name, hint: m.description ? `${m.provider} · ${m.description}` : m.provider }))}
        onClose={() => setModelOpen(false)}
        onSelect={(id) => setModelByKind((prev) => ({ ...prev, [kind]: id }))}
      />
    </ScrollView>
  );
}

/** The dials beyond the everyday ones. Only what the chosen model advertises is drawn. */
function MoreOptions({ kind, model, params, onChange }: {
  kind: MediaKind;
  model: ModelCapability;
  params: StudioParams;
  onChange: (next: Partial<StudioParams>) => void;
}) {
  const compressible = ['jpeg', 'jpg', 'webp'].includes((params.outputFormat ?? '').toLowerCase());
  const references = model.max_references ?? 0;
  return (
    <View style={{ gap: spacing.sm }}>
      {kind === 'image' && (model.qualities?.length ?? 0) > 0 ? (
        <Field label="Quality">
          <Chips<string> options={(model.qualities ?? []).map((q) => ({ value: q, label: q }))} value={params.quality ?? ''} onChange={(v) => onChange({ quality: v })} />
        </Field>
      ) : null}
      {kind === 'image' && (model.output_formats?.length ?? 0) > 0 ? (
        <Field label="File format">
          <Chips<string> options={(model.output_formats ?? []).map((f) => ({ value: f, label: f }))} value={params.outputFormat ?? ''} onChange={(v) => onChange({ outputFormat: v })} />
        </Field>
      ) : null}
      {kind === 'image' && (model.backgrounds?.length ?? 0) > 0 ? (
        <Field label="Background">
          <Chips<string> options={(model.backgrounds ?? []).map((b) => ({ value: b, label: b }))} value={params.background ?? ''} onChange={(v) => onChange({ background: v })} />
        </Field>
      ) : null}
      {kind === 'image' && model.output_compression && compressible ? (
        <Stepper
          label="Compression"
          value={params.outputCompression ?? model.output_compression.max}
          min={model.output_compression.min}
          max={model.output_compression.max}
          step={5}
          onChange={(v) => onChange({ outputCompression: v })}
        />
      ) : null}
      {kind === 'image' && model.batch ? (
        <Stepper
          label="Images per run"
          value={params.batchSize ?? model.batch.min}
          min={model.batch.min}
          max={model.batch.max}
          step={1}
          onChange={(v) => onChange({ batchSize: v })}
        />
      ) : null}
      {kind === 'video' ? (model.frame_slots ?? []).map((slot) => (
        <Field key={slot} label={FRAME_LABELS[slot] ?? slot} hint="optional">
          <TextBox
            accessibilityLabel={FRAME_LABELS[slot] ?? slot}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Image url the clip should start or end on"
            value={params.frameImages.find((f) => f.frame_type === slot)?.url ?? ''}
            onChangeText={(url) => {
              const rest = params.frameImages.filter((f) => f.frame_type !== slot);
              onChange({ frameImages: url ? [...rest, { url, frame_type: slot }] : rest });
            }}
          />
        </Field>
      )) : null}
      {kind === 'video' && model.supports_audio ? (
        <SwitchRow label="Generate audio track" value={params.generateAudio} onChange={(v) => onChange({ generateAudio: v })} />
      ) : null}
      {kind === 'audio' && (model.voices?.length ?? 0) === 0 ? (
        <Field label="Voice" hint="optional">
          <TextBox
            accessibilityLabel="Voice id"
            value={params.voice ?? ''}
            onChangeText={(v) => onChange({ voice: v })}
            placeholder="Provider voice id, blank for the default"
          />
        </Field>
      ) : null}
      {kind === 'audio' && model.supports_speed ? (
        <Stepper
          label="Speed"
          value={params.speed}
          min={model.speed_range?.min ?? 0.5}
          max={model.speed_range?.max ?? 2}
          step={0.05}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(v) => onChange({ speed: v })}
        />
      ) : null}
      {kind === 'audio' && model.supports_instructions ? (
        <Field label="Delivery" hint="optional">
          <TextBox
            accessibilityLabel="Delivery"
            value={params.instructions}
            onChangeText={(v) => onChange({ instructions: v })}
            placeholder="Speak warmly and unhurried, like a documentary narrator"
          />
        </Field>
      ) : null}
      {kind === 'audio' && (model.response_formats?.length ?? 0) > 1 ? (
        <Field label="Audio format" hint={params.responseFormat === 'pcm' ? 'raw, downloads' : 'plays inline'}>
          <Chips<string> options={(model.response_formats ?? []).map((f) => ({ value: f, label: f }))} value={params.responseFormat ?? ''} onChange={(v) => onChange({ responseFormat: v })} />
        </Field>
      ) : null}
      {kind !== 'audio' ? (
        <Field label="Negative prompt" hint="optional">
          <TextBox
            accessibilityLabel="Negative prompt"
            multiline
            value={params.negativePrompt}
            onChangeText={(v) => onChange({ negativePrompt: v })}
            placeholder="What to avoid: text, watermarks, blur"
          />
        </Field>
      ) : null}
      {model.supports_seed ? (
        <Field label="Seed" hint="blank for random">
          <TextBox
            accessibilityLabel="Seed"
            keyboardType="number-pad"
            value={params.seed}
            onChangeText={(v) => onChange({ seed: v.replace(/[^0-9]/g, '') })}
            placeholder="Random"
          />
        </Field>
      ) : null}
      {references > 0 ? (
        <Field label="Reference images" hint={`up to ${references}, one link per line`}>
          <TextBox
            accessibilityLabel="Reference images"
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            value={params.referenceUrls.join('\n')}
            onChangeText={(v) => onChange({ referenceUrls: v.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, references) })}
            placeholder="https://…"
          />
        </Field>
      ) : null}
    </View>
  );
}
