/**
 * The slash-command list above the composer, opened when the box starts with `/`.
 * Two modes: the command list (ranked by what has been typed after the slash), and
 * a completion list for the one argument the picked command needs (agent, file,
 * model...). Rows are 44pt and the list scrolls inside a capped height so the
 * keyboard never pushes it off screen. Pick a row to fill the box.
 */
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '../../components/Icon';
import { Text } from '../../components/Text';
import { spacing, typography, useTheme } from '../../theme';
import type { CommandCandidate, CommandDef } from './types';

const GROUP_LABELS: Record<string, string> = {
  agents: 'Agents',
  goals: 'Goals',
  memory: 'Memory',
  code: 'Code',
  browse: 'Browser',
  data: 'Data',
  files: 'Files',
  office: 'Documents',
  general: 'General',
};

interface Props {
  /** Command rows, ranked. Empty when showing completions. */
  commands: CommandDef[];
  /** Completion rows for the picked command's argument. Null when showing commands. */
  candidates: CommandCandidate[] | null;
  /** Heading for the completion list, e.g. "Choose an agent". */
  candidateTitle?: string;
  onPickCommand: (command: CommandDef) => void;
  onPickCandidate: (candidate: CommandCandidate) => void;
  loading?: boolean;
}

export function CommandPalette({ commands, candidates, candidateTitle, onPickCommand, onPickCandidate, loading = false }: Props) {
  const { colors, spacing: s, radius: r } = useTheme();
  const completing = candidates !== null;
  const empty = completing ? candidates.length === 0 : commands.length === 0;

  return (
    <View
      accessibilityRole="menu"
      style={[styles.panel, { borderColor: colors.border, backgroundColor: colors.surface, borderRadius: r.md }]}
    >
      <Text style={[typography.caption, { color: colors.mutedText, paddingHorizontal: s.md, paddingTop: s.sm }]}>
        {completing ? (candidateTitle ?? 'Choose one') : 'Commands'}
      </Text>
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.list}>
        {loading ? (
          <Text style={[typography.body, { color: colors.mutedText, padding: s.md }]}>Loading…</Text>
        ) : empty ? (
          <Text style={[typography.body, { color: colors.mutedText, padding: s.md }]}>
            {completing ? 'Nothing matches.' : 'No command matches. Try /help.'}
          </Text>
        ) : completing ? (
          candidates.map((c) => (
            <Row key={c.value} title={c.label} onPress={() => onPickCandidate(c)} />
          ))
        ) : (
          commands.map((c) => (
            <Row
              key={c.name}
              title={`/${c.name}`}
              subtitle={`${c.summary}${GROUP_LABELS[c.group] ? ` · ${GROUP_LABELS[c.group]}` : ''}`}
              onPress={() => onPickCommand(c)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function Row({ title, subtitle, onPress }: { title: string; subtitle?: string; onPress: () => void }) {
  const { colors, spacing: s } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1, paddingHorizontal: s.md }]}
    >
      <Icon name="terminal-outline" size={16} color={colors.mutedText} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[typography.label, { color: colors.text }]}>{title}</Text>
        {subtitle ? (
          <Text numberOfLines={1} style={[typography.caption, { color: colors.mutedText }]}>{subtitle}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: StyleSheet.hairlineWidth, maxHeight: 260, overflow: 'hidden' },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingVertical: spacing.sm },
});
