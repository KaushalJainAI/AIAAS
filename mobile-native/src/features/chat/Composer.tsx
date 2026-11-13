/**
 * The box a message is written in: staged files, the command palette, the text,
 * the send control, and the row of mode and model chips beneath it. Props only;
 * the screen decides what each control does.
 */
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { type ReactNode } from 'react';

import { Icon } from '../../components/Icon';
import { Text } from '../../components/Text';
import { fontFamily } from '../../fonts';
import { radius, spacing, typography, useTheme } from '../../theme';
import { modeColour } from './ChatSheets';
import { MODE_LABEL, type ChatMode } from './mode';
import type { StagedFile } from './attachments';

interface Props {
  draft: string;
  onChangeDraft: (text: string) => void;
  placeholder: string;
  busy: boolean;
  primaryLabel: 'Send' | 'Steer' | 'Stop';
  primaryDisabled: boolean;
  onPrimary: () => void;
  onAttach: () => void;
  staged: StagedFile[];
  onRemoveStaged: (key: string) => void;
  uploading: boolean;
  /** The command list or argument list, shown above the box. */
  palette: ReactNode;
  mode: ChatMode;
  onOpenMode: () => void;
  modelLabel: string;
  onOpenModel: () => void;
  notice: string | null;
}

export function Composer(props: Props) {
  const { colors, spacing: s, radius: r, fontSize: f } = useTheme();
  const {
    draft, onChangeDraft, placeholder, busy, primaryLabel, primaryDisabled, onPrimary, onAttach,
    staged, onRemoveStaged, uploading, palette, mode, onOpenMode, modelLabel, onOpenModel, notice,
  } = props;
  const stop = primaryLabel === 'Stop';

  return (
    <View style={[styles.wrap, { borderTopColor: colors.border, backgroundColor: colors.surface, padding: s.sm, gap: s.sm }]}>
      {notice ? (
        <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger, paddingHorizontal: s.xs }]}>
          {notice}
        </Text>
      ) : null}

      {palette}

      {staged.length > 0 || uploading ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: s.xs }}>
          {staged.map((file) => (
            <View
              key={file.key}
              style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.background, borderRadius: r.md }]}
            >
              <Icon name="attach-outline" size={14} color={colors.mutedText} />
              <Text numberOfLines={1} style={[typography.caption, { color: colors.text, maxWidth: 180 }]}>
                {file.name}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${file.name}`}
                onPress={() => onRemoveStaged(file.key)}
                hitSlop={10}
                style={styles.chipClose}
              >
                <Icon name="close" size={14} color={colors.mutedText} />
              </Pressable>
            </View>
          ))}
          {uploading ? <Text style={[typography.caption, { color: colors.mutedText, alignSelf: 'center' }]}>Uploading…</Text> : null}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: s.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach a file"
          onPress={onAttach}
          disabled={busy}
          style={[styles.round, { borderColor: colors.border, opacity: busy ? 0.5 : 1 }]}
        >
          <Icon name="add" size={22} color={colors.text} />
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={onChangeDraft}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedText}
          multiline
          accessibilityLabel="Message"
          style={[
            styles.input,
            {
              color: colors.text,
              backgroundColor: colors.inputBackground,
              borderColor: colors.border,
              borderRadius: r.md,
              fontSize: f.md,
              fontFamily: fontFamily.regular,
            },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={primaryLabel}
          disabled={primaryDisabled}
          onPress={onPrimary}
          style={({ pressed }) => [
            styles.send,
            {
              backgroundColor: stop ? colors.danger : colors.primary,
              borderRadius: r.md,
              opacity: primaryDisabled ? 0.5 : pressed ? 0.8 : 1,
            },
          ]}
        >
          <Text style={[typography.label, { color: colors.primaryText }]}>{primaryLabel}</Text>
        </Pressable>
      </View>

      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Mode: ${MODE_LABEL[mode]}`}
          onPress={onOpenMode}
          style={[styles.toolChip, { borderColor: modeColour(mode, colors) }]}
        >
          <Text style={[typography.caption, { color: modeColour(mode, colors), fontWeight: '600' }]}>{MODE_LABEL[mode]}</Text>
          <Icon name="chevron-down" size={12} color={modeColour(mode, colors)} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Model: ${modelLabel}`}
          onPress={onOpenModel}
          style={[styles.toolChip, styles.modelChip, { borderColor: colors.border }]}
        >
          <Icon name="sparkles-outline" size={14} color={colors.mutedText} />
          <Text numberOfLines={1} style={[typography.caption, { color: colors.mutedText, flexShrink: 1 }]}>{modelLabel}</Text>
          <Icon name="chevron-down" size={12} color={colors.mutedText} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, maxHeight: 140, minHeight: 44, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 10 },
  send: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' },
  round: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: StyleSheet.hairlineWidth, paddingLeft: spacing.sm, paddingRight: spacing.xs, minHeight: 32 },
  chipClose: { minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  modelChip: { flex: 1 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  toolChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 32, paddingHorizontal: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
});
