/** Model and thinking: provider, model, reasoning effort and temperature. The choices come from the model catalogue. */
import { useState } from 'react';

import { EFFORT_LABELS, TEMPERATURE_MAX, TEMPERATURE_MIN } from '../config';
import type { AgentConfig } from '../types';
import { BuilderScreen, type Builder } from './BuilderScreen';
import { Field, Note, Notice, Panel, PickerRow, PickerSheet, Stepper } from '../ui';

export function ModelScreen({ id }: { id: string }) {
  return <BuilderScreen id={id} title="Model and thinking" render={(b, cfg) => <ModelForm b={b} cfg={cfg} />} />;
}

type Open = 'provider' | 'model' | 'effort' | null;

export function ModelForm({ b, cfg }: { b: Builder; cfg: AgentConfig }) {
  const [open, setOpen] = useState<Open>(null);
  const models = b.activeProvider?.models ?? [];
  const providerName = b.providers.find((p) => p.slug === b.displayProvider)?.name ?? b.displayProvider;
  const modelName = models.find((m) => m.value === b.effectiveModel)?.name ?? b.effectiveModel;
  const retired = b.saved?.model_status === 'retired' && b.saved.model === b.effectiveModel;
  const temperatureHint = cfg.temperature <= 0.2 ? 'deterministic' : cfg.temperature >= 0.7 ? 'varied' : 'balanced';

  return (
    <>
      <Panel>
        <PickerRow
          label="Provider"
          value={providerName}
          placeholder="Choose a provider"
          error={b.errors.provider}
          onPress={() => setOpen('provider')}
        />
        <PickerRow
          label="Model"
          value={modelName}
          placeholder="Choose a model"
          error={b.errors.model}
          onPress={() => setOpen('model')}
        />
        {retired ? (
          <Notice text="This model has been retired, so runs use the platform fallback until you pick another. Pick another model and save." tone="warning" />
        ) : null}
        {b.effortLevels.length > 0 ? (
          <>
            <PickerRow
              label="Reasoning effort"
              value={cfg.effort ? EFFORT_LABELS[cfg.effort] ?? cfg.effort : 'Model default'}
              error={b.errors.effort}
              hint={cfg.effort || 'model default'}
              onPress={() => setOpen('effort')}
            />
            <Note>
              Raise it for multi-step analysis. Extraction, routing and formatting do not get better for the extra
              thinking, and it is billed either way.
            </Note>
          </>
        ) : (
          <Field label="Reasoning effort" hint="not supported" error={b.errors.effort}>
            <Note>
              {b.effectiveModel
                ? 'This model has no reasoning-effort setting. Pick a reasoning model to control how hard it thinks.'
                : 'Choose a model to see whether it supports reasoning effort.'}
            </Note>
          </Field>
        )}
        <Stepper
          label="Temperature"
          hint={temperatureHint}
          value={cfg.temperature}
          min={TEMPERATURE_MIN}
          max={TEMPERATURE_MAX}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) => b.set('temperature', v)}
        />
        <Note>Extraction and classification want 0. Drafting reads better nearer 0.7.</Note>
      </Panel>

      <PickerSheet
        visible={open === 'provider'}
        title="Provider"
        value={b.displayProvider}
        options={b.providers.map((p) => ({ value: p.slug, label: p.name }))}
        onClose={() => setOpen(null)}
        onSelect={(slug) => {
          const next = b.providers.find((p) => p.slug === slug);
          b.setCfg({ ...cfg, provider: slug, model: next?.models?.[0]?.value ?? '' });
        }}
      />
      <PickerSheet
        visible={open === 'model'}
        title="Model"
        searchable={models.length > 8}
        value={b.effectiveModel}
        options={models.map((m) => ({
          value: m.value,
          label: m.is_free ? `${m.name} · free` : m.name,
          hint: m.description || undefined,
        }))}
        emptyText="This provider has no models yet."
        onClose={() => setOpen(null)}
        onSelect={(value) => b.set('model', value)}
      />
      <PickerSheet
        visible={open === 'effort'}
        title="Reasoning effort"
        value={cfg.effort}
        options={[
          { value: '', label: 'Model default' },
          ...b.effortLevels.map((level) => ({ value: level, label: EFFORT_LABELS[level] ?? level })),
        ]}
        onClose={() => setOpen(null)}
        onSelect={(value) => b.set('effort', value)}
      />
    </>
  );
}
