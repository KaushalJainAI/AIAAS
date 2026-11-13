import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { ErrorText } from '../../components/ErrorText';
import { Icon } from '../../components/Icon';
import { LoadingState } from '../../components/LoadingState';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { success } from '../../lib/haptics';
import { spacing, typography, useTheme } from '../../theme';
import { EXTRACT_LIMIT, messageOf, percent } from './format';
import { useExtractDocuments, usePickerDocuments } from './queries';

/**
 * Pick documents and run the schema's extraction over them. The web's
 * "Extract with ..." dialog: the rows arrive later when the run is queued.
 */
export function ExtractSheet({
  schemaId,
  schemaName,
  threshold,
  onClose,
  onDone,
}: {
  schemaId: number;
  schemaName: string;
  threshold: number;
  onClose: () => void;
  /** Called with the outcome line once the run has been accepted. */
  onDone: (message: string) => void;
}) {
  const { colors } = useTheme();
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const docs = usePickerDocuments(true);
  const run = useExtractDocuments(schemaId);

  const toggle = (id: number) => {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < EXTRACT_LIMIT) next.add(id);
      return next;
    });
  };

  const start = () => {
    if (chosen.size === 0 || run.isPending) return;
    run.mutate([...chosen], {
      onSuccess: (res) => {
        success();
        const message = res.async
          ? 'Extraction started. It is running in the background.'
          : extractionSummary(res);
        onDone(message);
      },
    });
  };

  return (
    <Sheet visible onClose={onClose} title={`Extract with "${schemaName}"`}>
      <View style={styles.body}>
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          Runs the LLM over the documents you pick; rows below {percent(threshold)} confidence are held for review.
        </Text>

        {docs.isPending ? (
          <LoadingState text="Loading documents" />
        ) : docs.isError ? (
          <ErrorText message={messageOf(docs.error, 'Your documents could not be loaded.')} />
        ) : docs.data.length === 0 ? (
          <Text style={[typography.body, styles.centre, { color: colors.mutedText }]}>
            No personal documents yet — upload some first.
          </Text>
        ) : (
          <ScrollView style={styles.list}>
            {docs.data.map((doc) => {
              const on = chosen.has(doc.id);
              return (
                <Pressable
                  key={doc.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={doc.title || doc.filename}
                  onPress={() => toggle(doc.id)}
                  style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <Icon name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.primary : colors.mutedText} />
                  <Text style={[typography.body, styles.name, { color: colors.text }]} numberOfLines={1}>
                    {doc.title || doc.filename}
                  </Text>
                  <Text style={[typography.caption, { color: colors.mutedText }]}>{doc.chunk_count} chunks</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <ErrorText message={run.isError ? messageOf(run.error, 'Could not start that extraction.') : null} />

        <View style={styles.actions}>
          <View style={styles.action}>
            <Button
              title={chosen.size > 0 ? `Extract ${chosen.size} document${chosen.size === 1 ? '' : 's'}` : 'Extract'}
              loading={run.isPending}
              disabled={chosen.size === 0 || run.isPending}
              onPress={start}
            />
          </View>
          <View style={styles.action}>
            <Button title="Cancel" variant="secondary" disabled={run.isPending} onPress={onClose} />
          </View>
        </View>
      </View>
    </Sheet>
  );
}

/** The web's summary of an inline run: documents processed, held for review, failed. */
function extractionSummary(res: Record<string, unknown>): string {
  const processed = Number(res.processed ?? 0);
  const held = Number(res.needs_review ?? 0);
  const errors = Array.isArray(res.errors) ? res.errors.length : 0;
  let text = `Extraction finished: ${processed} document${processed === 1 ? '' : 's'} processed`;
  if (held) text += `, ${held} held for review`;
  if (errors) text += `, ${errors} failed`;
  return `${text}.`;
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, paddingBottom: spacing.md },
  list: { maxHeight: 360 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
  name: { flex: 1 },
  centre: { textAlign: 'center', paddingVertical: spacing.lg },
  actions: { flexDirection: 'row', gap: spacing.md },
  action: { flex: 1 },
});
