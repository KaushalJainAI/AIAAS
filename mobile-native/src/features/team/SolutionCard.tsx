import { Pressable, StyleSheet, View } from 'react-native';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { pressedOpacity, spacing, typography, useTheme } from '../../theme';
import { attentionLabel } from './page';
import { Badges } from './presentation';
import type { Solution } from './types';

export interface SolutionCardProps {
  s: Solution;
  /** The "Needs attention" view: show why it is there, and the three things that clear it. */
  attentionView: boolean;
  busy: boolean;
  onOpen: () => void;
  onTag: (tag: string) => void;
  onStillTrue: () => void;
  onEdit: () => void;
  onRetract: () => void;
}

/** One saved solution in a list. Tapping it opens the detail; tags filter the list. */
export function SolutionCard({ s, attentionView, busy, onOpen, onTag, onStillTrue, onEdit, onRetract }: SolutionCardProps) {
  const { colors } = useTheme();
  const reasons = s.attention ?? [];
  const tags = s.tags ?? [];

  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={s.problem}
        onPress={onOpen}
        style={({ pressed }) => ({ opacity: pressed ? pressedOpacity : 1, gap: spacing.sm })}
      >
        <Text style={[typography.label, { color: colors.text }]}>{s.problem}</Text>
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          {s.solved_by} · {s.solved_on} · worked for {s.track_record.worked}
        </Text>
        <Badges s={s} />
      </Pressable>

      {attentionView && reasons.length > 0 ? (
        <View style={styles.row} accessibilityLabel="Why it needs attention">
          {reasons.map((reason) => (
            <Badge key={reason} label={attentionLabel(reason)} tone="warning" />
          ))}
        </View>
      ) : null}

      {tags.length > 0 ? (
        <View style={styles.row}>
          {tags.map((tag) => (
            <Pressable
              key={tag}
              accessibilityRole="button"
              accessibilityLabel={`Show only solutions tagged ${tag}`}
              onPress={() => onTag(tag)}
              style={({ pressed }) => [
                styles.tag,
                { borderColor: colors.border, opacity: pressed ? pressedOpacity : 1 },
              ]}
            >
              <Text style={[typography.caption, { color: colors.mutedText }]}>{tag}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {attentionView ? (
        <View style={styles.actions}>
          <View style={styles.action}>
            <Button title="Still true" variant="secondary" disabled={busy} onPress={onStillTrue} />
          </View>
          {s.can_manage ? (
            <>
              <View style={styles.action}>
                <Button title="Edit" variant="secondary" disabled={busy} onPress={onEdit} />
              </View>
              <View style={styles.action}>
                <Button title="Retract" variant="secondary" disabled={busy} onPress={onRetract} />
              </View>
            </>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  tag: { minHeight: 28, justifyContent: 'center', paddingHorizontal: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: 4 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  action: { flex: 1 },
});
