/**
 * The box a message is written in: staged files, the command palette, then one
 * rounded field holding the text and, beneath it, attach, the mode and model
 * chips and a round send button. Props only; the screen decides what each
 * control does.
 *
 * One field instead of a text box, a "Send" button and a separate chip row:
 * on a phone the old three pieces read as clutter, and the send button's
 * label changed width as it moved between Send, Steer and Stop.
 */
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { type ReactNode } from 'react';

import { Icon, type IconName } from '../../components/Icon';
import { Text } from '../../components/Text';
import { fontFamily } from '../../fonts';
import { pressedOpacity, spacing, typography, useTheme } from '../../theme';
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

/** The send button's glyph for each of its three meanings. */
const PRIMARY_ICON: Record<Props['primaryLabel'], IconName> = {
  Send: 'arrow-up',
  Steer: 'arrow-redo',
  Stop: 'stop',
};

/** A small rounded chip in the field's bottom row. */
function Chip({
  label,
  accessibilityLabel,
  icon,
  tint,
  onPress,
  grow = false,
}: {
  label: string;
  accessibilityLabel: string;
  icon?: IconName;
  tint: string;
  onPress: () => void;
  grow?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.chipHit, grow && styles.shrink, { opacity: pressed ? pressedOpacity : 1 }]}
    >
      <View style={[styles.chip, grow && styles.shrink, { backgroundColor: colors.surfaceMuted }]}>
        {icon ? <Icon name={icon} size={13} color={tint} /> : null}
        <Text numberOfLines={1} style={[typography.caption, styles.shrink, { color: tint, fontFamily: fontFamily.medium }]}>
          {label}
        </Text>
        <Icon name="chevron-down" size={11} color={tint} />
      </View>
    </Pressable>
  );
}

export function Composer(props: Props) {
  const { colors, spacing: s, radius: r, fontSize: f } = useTheme();
  const {
    draft, onChangeDraft, placeholder, busy, primaryLabel, primaryDisabled, onPrimary, onAttach,
    staged, onRemoveStaged, uploading, palette, mode, onOpenMode, modelLabel, onOpenModel, notice,
  } = props;
  const stop = primaryLabel === 'Stop';
  // Plain "ask" is the quiet default; every other mode keeps its colour so a
  // riskier level is never missed.
  const modeTint = mode === 'ask' ? colors.text : modeColour(mode, colors);

  return (
    <View style={[styles.wrap, { borderTopColor: colors.border, backgroundColor: colors.background, padding: s.sm, gap: s.sm }]}>
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
              style={[styles.file, { backgroundColor: colors.surfaceMuted, borderRadius: r.lg }]}
            >
              <Icon name="document-attach-outline" size={14} color={colors.mutedText} />
              <Text numberOfLines={1} style={[typography.caption, { color: colors.text, maxWidth: 180 }]}>
                {file.name}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${file.name}`}
                onPress={() => onRemoveStaged(file.key)}
                hitSlop={10}
                style={styles.fileClose}
              >
                <Icon name="close-circle" size={16} color={colors.mutedText} />
              </Pressable>
            </View>
          ))}
          {uploading ? <Text style={[typography.caption, { color: colors.mutedText, alignSelf: 'center' }]}>Uploading…</Text> : null}
        </View>
      ) : null}

      <View style={[styles.field, { backgroundColor: colors.surface, borderColor: colors.borderStrong }]}>
        <TextInput
          value={draft}
          onChangeText={onChangeDraft}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedText}
          multiline
          accessibilityLabel="Message"
          style={[styles.input, { color: colors.text, fontSize: f.lg, fontFamily: fontFamily.regular }]}
        />

        <View style={styles.toolbar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Attach a file"
            onPress={onAttach}
            disabled={busy}
            style={({ pressed }) => [styles.iconHit, { opacity: busy ? 0.4 : pressed ? pressedOpacity : 1 }]}
          >
            <View style={[styles.iconCircle, { borderColor: colors.border }]}>
              <Icon name="add" size={20} color={colors.text} />
            </View>
          </Pressable>

          <Chip
            label={MODE_LABEL[mode]}
            accessibilityLabel={`Mode: ${MODE_LABEL[mode]}`}
            icon="shield-checkmark-outline"
            tint={modeTint}
            onPress={onOpenMode}
          />
          <Chip
            label={modelLabel}
            accessibilityLabel={`Model: ${modelLabel}`}
            icon="sparkles-outline"
            tint={colors.mutedText}
            onPress={onOpenModel}
            grow
          />

          <View style={styles.spacer} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={primaryLabel}
            disabled={primaryDisabled}
            onPress={onPrimary}
            style={({ pressed }) => [styles.iconHit, { opacity: primaryDisabled ? 0.35 : pressed ? pressedOpacity : 1 }]}
          >
            <View style={[styles.send, { backgroundColor: stop ? colors.danger : colors.primary }]}>
              <Icon name={PRIMARY_ICON[primaryLabel]} size={stop ? 14 : 18} color={colors.primaryText} />
            </View>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth },
  field: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 22, paddingTop: spacing.sm, paddingHorizontal: spacing.xs },
  input: { maxHeight: 140, minHeight: 40, paddingHorizontal: spacing.sm, paddingTop: 6, paddingBottom: 4, textAlignVertical: 'top' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  spacer: { flex: 1 },
  iconHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  iconCircle: { width: 34, height: 34, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  chipHit: { minHeight: 44, justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 30, paddingHorizontal: 10, borderRadius: 15 },
  shrink: { flexShrink: 1 },
  file: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingLeft: spacing.sm, paddingRight: spacing.xs, minHeight: 32 },
  fileClose: { minWidth: 28, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
});
