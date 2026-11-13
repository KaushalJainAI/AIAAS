import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Badge, type Tone } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { useTheme, spacing, typography } from '../../theme';
import { percent, ROW_STATUS_LABEL, valueText } from './format';
import type { ExtractedRow, RowStatus } from './types';

const TONE: Record<RowStatus, Tone> = {
  needs_review: 'danger',
  accepted: 'neutral',
  reviewed: 'success',
  rejected: 'neutral',
};

export interface RowActions {
  onAccept: (row: ExtractedRow) => void;
  onFix: (row: ExtractedRow, data: Record<string, unknown>) => void;
  onReject: (row: ExtractedRow) => void;
}

/**
 * One extracted row: the document, its confidence, each value, and the three
 * ways a held row is cleared (accept, fix, reject). A value below the schema's
 * threshold is shown in red with its own confidence, as the web does.
 */
export function ExtractedRowCard({
  row,
  names,
  threshold,
  busy,
  actions,
}: {
  row: ExtractedRow;
  /** The fields to show, in order. Defaults to the row's own keys. */
  names?: string[];
  /** Below this a field is doubtful. Omitted where the threshold is not known. */
  threshold?: number;
  busy: boolean;
  actions: RowActions;
}) {
  const { colors } = useTheme();
  const [fixing, setFixing] = useState(false);
  const fields = names ?? Object.keys(row.data);
  const held = row.status === 'needs_review';

  return (
    <Card>
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={[typography.label, { color: colors.text }]}>{row.document_name}</Text>
          <Text style={[typography.caption, { color: colors.mutedText }]}>
            {new Date(row.created_at).toLocaleDateString()} · {percent(row.confidence)} confident
          </Text>
        </View>
        <Badge label={ROW_STATUS_LABEL[row.status]} tone={TONE[row.status]} />
      </View>

      <View style={styles.values}>
        {fields.map((name) => {
          const conf = row.field_confidence?.[name];
          const doubtful = threshold !== undefined && conf !== undefined && conf < threshold;
          return (
            <View key={name} style={styles.line}>
              <Text style={[typography.caption, styles.name, { color: colors.mutedText }]} numberOfLines={1}>
                {name}
              </Text>
              <Text style={[typography.body, styles.value, { color: doubtful ? colors.danger : colors.text }]}>
                {valueText(row.data[name]) || '—'}
                {doubtful ? ` (${percent(conf)})` : ''}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.actions}>
        {held ? (
          <>
            <View style={styles.action}>
              <Button title="Accept" loading={busy} disabled={busy} onPress={() => actions.onAccept(row)} />
            </View>
            <View style={styles.action}>
              <Button title="Fix" variant="secondary" disabled={busy} onPress={() => setFixing(true)} />
            </View>
            <View style={styles.action}>
              <Button title="Reject" variant="secondary" disabled={busy} onPress={() => actions.onReject(row)} />
            </View>
          </>
        ) : (
          <View style={styles.action}>
            <Button title="Edit" variant="secondary" disabled={busy} onPress={() => setFixing(true)} />
          </View>
        )}
      </View>

      {fixing ? (
        <FixSheet
          row={row}
          names={fields}
          onClose={() => setFixing(false)}
          onSave={(data) => {
            setFixing(false);
            actions.onFix(row, data);
          }}
        />
      ) : null}
    </Card>
  );
}

/** Corrects the values of one row. The corrected row is recorded against the person who saved it. */
function FixSheet({
  row,
  names,
  onClose,
  onSave,
}: {
  row: ExtractedRow;
  names: string[];
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(names.map((n) => [n, valueText(row.data[n])])),
  );
  return (
    <Sheet visible onClose={onClose} title="Correct the values">
      <View style={styles.sheetBody}>
        {names.map((n) => (
          <TextField
            key={n}
            label={n}
            value={draft[n] ?? ''}
            onChangeText={(text) => setDraft((prev) => ({ ...prev, [n]: text }))}
          />
        ))}
        <View style={styles.actions}>
          <View style={styles.action}>
            <Button title="Save correction" onPress={() => onSave(draft)} />
          </View>
          <View style={styles.action}>
            <Button title="Cancel" variant="secondary" onPress={onClose} />
          </View>
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headText: { flex: 1, gap: 2 },
  values: { marginTop: spacing.md, gap: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.md },
  name: { width: 96 },
  value: { flex: 1 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  action: { flex: 1 },
  sheetBody: { gap: spacing.md, paddingBottom: spacing.md },
});
