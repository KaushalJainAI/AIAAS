/**
 * The agent's plan for one generation, waiting for a yes. Approve, edit the prompt
 * or model, or cancel. Nothing is spent until one of these is chosen.
 * Mirrors better-n8n-frontend/src/components/imagine/IntentPreviewCard.tsx.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { spacing, typography, useTheme } from '../../theme';
import { Field, Note, Panel, PickerRow, PickerSheet, TextBox } from '../builder/ui';
import type { ImagineIntent, ModelCapability, MediaKind } from './types';

interface Props {
  intent: ImagineIntent;
  /** The catalogue entries for this kind, for the model picker in edit mode. */
  models: ModelCapability[];
  disabled: boolean;
  onApprove: () => void;
  onEdit: (overrides: Partial<ImagineIntent>) => void;
  onCancel: () => void;
}

const KIND_WORD: Record<MediaKind, string> = { image: 'Image', video: 'Video', audio: 'Audio' };

export function IntentCard({ intent, models, disabled, onApprove, onEdit, onCancel }: Props) {
  const { colors } = useTheme();
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(intent.prompt);
  const [model, setModel] = useState(intent.model ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const chosen = models.find((m) => m.id === model);
  const chips = Object.entries(intent.params ?? {}).filter(([, v]) => v != null && v !== '');
  const cost = typeof intent.estimated_cost_usd === 'number' ? intent.estimated_cost_usd.toFixed(2) : '—';

  return (
    <Panel>
      <Text style={[typography.label, { color: colors.text }]}>
        {KIND_WORD[intent.type] ?? intent.type} · {intent.model || 'no model'}
      </Text>
      <Note>
        About ${cost} · {Math.round((intent.confidence ?? 0) * 100)}% sure of the reading
      </Note>

      {!editing ? (
        <Text style={[typography.body, { color: colors.text }]}>{intent.prompt}</Text>
      ) : (
        <>
          <Field label="Prompt">
            <TextBox accessibilityLabel="Prompt" multiline value={prompt} onChangeText={setPrompt} />
          </Field>
          <PickerRow
            label="Model"
            value={chosen?.name ?? model}
            placeholder="Choose a model"
            hint={chosen?.provider}
            onPress={() => setPickerOpen(true)}
          />
        </>
      )}

      {chips.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {chips.map(([k, v]) => (
            <Text key={k} style={[typography.caption, { color: colors.mutedText }]}>
              {k}: {String(v)}
            </Text>
          ))}
        </View>
      ) : null}

      {intent.reasoning ? <Note>{intent.reasoning}</Note> : null}

      {!editing ? (
        <>
          <Button title="Approve" onPress={onApprove} disabled={disabled} />
          <Button title="Edit" variant="secondary" onPress={() => setEditing(true)} disabled={disabled} />
          <Button title="Cancel" variant="secondary" onPress={onCancel} disabled={disabled} />
        </>
      ) : (
        <>
          <Button
            title="Generate with edits"
            onPress={() => onEdit({ prompt: prompt.trim() || intent.prompt, model: model || intent.model || undefined })}
            disabled={disabled || !prompt.trim()}
          />
          <Button title="Back" variant="secondary" onPress={() => setEditing(false)} disabled={disabled} />
        </>
      )}

      <PickerSheet
        visible={pickerOpen}
        title="Model"
        searchable={models.length > 8}
        value={model}
        options={models.map((m) => ({ value: m.id, label: m.name, hint: m.provider }))}
        onClose={() => setPickerOpen(false)}
        onSelect={(id) => setModel(id)}
      />
    </Panel>
  );
}
