/**
 * The sheets a chat opens: its mode, its model and effort, where a file comes
 * from, the chat menu, and the chat's own settings. Each is a Sheet, because a
 * choice is made in one, never in an alert.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Switch } from '../../components/Switch';

import { Button } from '../../components/Button';
import { Icon, type IconName } from '../../components/Icon';
import { ListRow } from '../../components/ListRow';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { fontFamily } from '../../fonts';
import { EFFORT_HINTS, EFFORT_LABELS, EFFORT_LADDER, effortLevelsFor, nearestEffort } from '../account/models';
import { useAIModels } from '../account/queries';
import { spacing, typography, useTheme } from '../../theme';
import { MODE_HINT, MODE_LABEL, CHAT_MODES, type ChatMode } from './mode';
import type { ChatSessionDetail } from './types';

// --- mode ---------------------------------------------------------------------

/** The four modes. Colours are the theme's: Ask is quiet, Auto warns, Plan informs, Full auto is danger. */
export function modeColour(mode: ChatMode, colors: ReturnType<typeof useTheme>['colors']): string {
  if (mode === 'auto') return colors.warning;
  if (mode === 'plan') return colors.info;
  if (mode === 'full') return colors.danger;
  return colors.mutedText;
}

export function ModeSheet({
  visible,
  value,
  onPick,
  onClose,
}: {
  visible: boolean;
  value: ChatMode;
  onPick: (mode: ChatMode) => void;
  onClose: () => void;
}) {
  const { colors, spacing: s, radius: r } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title="Mode">
      <View style={{ gap: s.sm, paddingBottom: s.md }}>
        {CHAT_MODES.map((mode) => {
          const on = mode === value;
          const tint = modeColour(mode, colors);
          return (
            <Pressable
              key={mode}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${MODE_LABEL[mode]}. ${MODE_HINT[mode]}`}
              onPress={() => {
                onPick(mode);
                onClose();
              }}
              style={[
                styles.choice,
                { borderColor: on ? tint : colors.border, borderRadius: r.md, backgroundColor: colors.surface },
              ]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[typography.label, { color: mode === 'full' ? colors.danger : colors.text }]}>{MODE_LABEL[mode]}</Text>
                <Text style={[typography.caption, { color: colors.mutedText }]}>{MODE_HINT[mode]}</Text>
              </View>
              {on ? <Icon name="checkmark" size={18} color={tint} /> : null}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

// --- model and effort -----------------------------------------------------------

export function ModelSheet({
  visible,
  provider,
  model,
  effort,
  onPickModel,
  onPickEffort,
  onClose,
}: {
  visible: boolean;
  provider: string;
  model: string;
  effort: string;
  onPickModel: (provider: string, model: string) => void;
  onPickEffort: (level: string) => void;
  onClose: () => void;
}) {
  const { colors, spacing: s, radius: r } = useTheme();
  const catalogue = useAIModels();
  const [query, setQuery] = useState('');
  const providers = useMemo(() => catalogue.data?.providers ?? [], [catalogue.data]);
  const offered = effortLevelsFor(providers, provider, model);
  const shown = nearestEffort(effort, offered);
  const needle = query.trim().toLowerCase();

  const groups = useMemo(
    () =>
      providers
        .map((p) => ({
          ...p,
          models: p.models.filter((m) => !needle || m.name.toLowerCase().includes(needle) || m.value.toLowerCase().includes(needle)),
        }))
        .filter((p) => p.models.length > 0),
    [providers, needle],
  );

  return (
    <Sheet visible={visible} onClose={onClose} title="Model">
      <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: s.md, paddingBottom: s.md }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search models..."
            placeholderTextColor={colors.mutedText}
            accessibilityLabel="Search models"
            style={[styles.input, { color: colors.text, backgroundColor: colors.inputBackground, borderColor: colors.border, borderRadius: r.md, fontFamily: fontFamily.regular }]}
          />
          {catalogue.isPending ? (
            <Text style={[typography.body, { color: colors.mutedText }]}>Loading models…</Text>
          ) : catalogue.isError ? (
            <Text style={[typography.body, { color: colors.danger }]}>Could not load models.</Text>
          ) : (
            groups.map((p) => (
              <View key={p.slug} style={{ gap: s.xs }}>
                <Text style={[typography.caption, { color: colors.mutedText, fontWeight: '600' }]}>{p.name}</Text>
                {p.models.map((m) => {
                  const on = p.slug === provider && m.value === model;
                  return (
                    <Pressable
                      key={`${p.slug}/${m.value}`}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on, disabled: m.available === false }}
                      disabled={m.available === false}
                      onPress={() => onPickModel(p.slug, m.value)}
                      style={[styles.choice, { borderColor: on ? colors.primary : colors.border, borderRadius: r.md, backgroundColor: colors.surface, opacity: m.available === false ? 0.5 : 1 }]}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text numberOfLines={1} style={[typography.label, { color: colors.text }]}>{m.name}</Text>
                        <Text numberOfLines={2} style={[typography.caption, { color: colors.mutedText }]}>
                          {m.available === false ? 'Add a key for this provider to use it.' : m.description}
                        </Text>
                      </View>
                      {on ? <Icon name="checkmark" size={18} color={colors.primary} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            ))
          )}

          <View style={{ gap: s.xs }}>
            <Text style={[typography.label, { color: colors.text }]}>Effort</Text>
            {offered.length === 0 ? (
              <Text style={[typography.caption, { color: colors.mutedText }]}>
                This model has no effort control. Pick a different model to change how hard it thinks.
              </Text>
            ) : (
              <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: s.sm }}>
                  {EFFORT_LADDER.filter((level) => offered.includes(level)).map((level) => {
                    const on = shown === level;
                    return (
                      <Pressable
                        key={level}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={`${EFFORT_LABELS[level]}. ${EFFORT_HINTS[level]}`}
                        onPress={() => onPickEffort(level)}
                        style={[styles.chip, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface, borderRadius: r.md }]}
                      >
                        <Text style={[typography.label, { color: on ? colors.primaryText : colors.text }]}>{EFFORT_LABELS[level]}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={[typography.caption, { color: colors.mutedText }]}>{EFFORT_HINTS[shown] ?? ''}</Text>
              </>
            )}
          </View>
        </View>
      </ScrollView>
    </Sheet>
  );
}

// --- attach -------------------------------------------------------------------

export function AttachSheet({
  visible,
  onDocuments,
  onPhotos,
  onClose,
}: {
  visible: boolean;
  onDocuments: () => void;
  onPhotos: () => void;
  onClose: () => void;
}) {
  const { spacing: s } = useTheme();
  const pick = (run: () => void) => () => {
    onClose();
    run();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Attach">
      <View style={{ gap: s.sm, paddingBottom: s.md }}>
        <ListRow title="Document" subtitle="Any file from this device" icon="document-outline" onPress={pick(onDocuments)} />
        <ListRow title="Photo" subtitle="An image from your library" icon="image-outline" onPress={pick(onPhotos)} />
      </View>
    </Sheet>
  );
}

// --- chat menu and settings -------------------------------------------------------

export interface MenuAction {
  label: string;
  icon: IconName;
  onPress: () => void;
  destructive?: boolean;
}

/** The chat's own menu, opened from the header. Each row is one action. */
export function SessionMenuSheet({ visible, actions, onClose }: { visible: boolean; actions: MenuAction[]; onClose: () => void }) {
  const { spacing: s } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title="Chat">
      <View style={{ paddingBottom: s.md }}>
        {actions.map((a) => (
          <ListRow
            key={a.label}
            title={a.label}
            icon={a.icon}
            destructive={a.destructive}
            onPress={() => {
              onClose();
              a.onPress();
            }}
          />
        ))}
      </View>
    </Sheet>
  );
}

/** Title, standing instructions and memory for this chat. Saved as one patch. */
export function SessionSettingsSheet({
  visible,
  session,
  saving,
  onSave,
  onClose,
}: {
  visible: boolean;
  session: ChatSessionDetail;
  saving: boolean;
  onSave: (patch: Partial<ChatSessionDetail>) => void;
  onClose: () => void;
}) {
  const { colors, spacing: s, radius: r } = useTheme();
  const [title, setTitle] = useState(session.title ?? '');
  const [prompt, setPrompt] = useState(session.system_prompt ?? '');
  const [memory, setMemory] = useState(session.memory_enabled !== false);
  const fieldStyle = [styles.input, { color: colors.text, backgroundColor: colors.inputBackground, borderColor: colors.border, borderRadius: r.md, fontFamily: fontFamily.regular }];

  return (
    <Sheet visible={visible} onClose={onClose} title="Chat settings">
      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }}>
        <View style={{ gap: s.lg, paddingBottom: s.md }}>
          <View style={{ gap: s.xs }}>
            <Text style={[typography.label, { color: colors.text }]}>Title</Text>
            <TextInput value={title} onChangeText={setTitle} accessibilityLabel="Title" style={fieldStyle} />
          </View>
          <View style={{ gap: s.xs }}>
            <Text style={[typography.label, { color: colors.text }]}>System prompt</Text>
            <Text style={[typography.caption, { color: colors.mutedText }]}>
              Standing instructions for this conversation. Applies to every message, including ones already sent.
            </Text>
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              multiline
              numberOfLines={5}
              placeholder="e.g. Answer concisely. Prefer tables over prose. Always cite sources."
              placeholderTextColor={colors.mutedText}
              accessibilityLabel="System prompt"
              style={[...fieldStyle, { minHeight: 110, textAlignVertical: 'top' }]}
            />
          </View>
          <View style={styles.switchRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[typography.label, { color: colors.text }]}>Memory</Text>
              <Text style={[typography.caption, { color: colors.mutedText }]}>
                Let this chat use earlier conversation. Turning it off forgets nothing.
              </Text>
            </View>
            <Switch value={memory} onValueChange={setMemory} accessibilityLabel="Memory" />
          </View>
          <Button
            title="Save"
            loading={saving}
            onPress={() => {
              const patch: Partial<ChatSessionDetail> = {};
              if (title.trim() && title.trim() !== session.title) patch.title = title.trim();
              if (prompt !== (session.system_prompt ?? '')) patch.system_prompt = prompt;
              if (memory !== (session.memory_enabled !== false)) patch.memory_enabled = memory;
              if (Object.keys(patch).length === 0) return onClose();
              onSave(patch);
            }}
          />
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  choice: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, minHeight: 44 },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, borderWidth: StyleSheet.hairlineWidth },
  input: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 44 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
