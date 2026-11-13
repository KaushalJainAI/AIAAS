import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { ErrorText } from '../../components/ErrorText';
import { LoadingState } from '../../components/LoadingState';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { success } from '../../lib/haptics';
import { typography, spacing, useTheme } from '../../theme';
import { DEFAULT_FIELD_TEXT, messageOf, parseFieldNames } from './format';
import { useCreateSchema, useExtractionSchema, useUpdateSchema } from './queries';
import type { ExtractionSchema, SchemaField } from './types';

/**
 * Create a schema, or edit one (`id` given). Fields are typed one per line, as the
 * web's form takes them. A field that already exists keeps its type and label.
 */
export function SchemaFormScreen({ id }: { id: number | null }) {
  if (id == null) return <SchemaForm initial={null} />;
  return <EditSchema id={id} />;
}

function EditSchema({ id }: { id: number }) {
  const schema = useExtractionSchema(id);
  if (schema.isPending) return <LoadingState text="Loading schema" />;
  if (schema.isError) {
    return <ErrorState message={messageOf(schema.error, 'This schema could not be loaded.')} onRetry={() => void schema.refetch()} />;
  }
  return <SchemaForm initial={schema.data} />;
}

function SchemaForm({ initial }: { initial: ExtractionSchema | null }) {
  const router = useRouter();
  const { colors } = useTheme();
  const create = useCreateSchema();
  const update = useUpdateSchema();
  const [name, setName] = useState(initial?.name ?? '');
  const [fieldText, setFieldText] = useState(
    initial ? initial.fields.map((f) => f.name).join('\n') : DEFAULT_FIELD_TEXT,
  );
  const [error, setError] = useState<string | null>(null);
  const saving = create.isPending || update.isPending;

  const save = () => {
    if (!name.trim() || saving) return;
    setError(null);
    const existing = new Map<string, SchemaField>((initial?.fields ?? []).map((f) => [f.name, f]));
    const body: Partial<ExtractionSchema> = {
      name: name.trim(),
      fields: parseFieldNames(fieldText).map((fieldName) => {
        const kept = existing.get(fieldName);
        return kept ? { ...kept, name: fieldName } : { name: fieldName, type: 'string' as const };
      }),
    };
    const done = {
      onSuccess: () => {
        success();
        router.back();
      },
      onError: (e: unknown) => setError(messageOf(e, 'Could not save that schema.')),
    };
    if (initial) update.mutate({ id: initial.id, body }, done);
    else create.mutate(body, done);
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TextField
        label="Schema name"
        value={name}
        onChangeText={setName}
        placeholder="Purchase invoices"
        placeholderTextColor={colors.mutedText}
        autoFocus={!initial}
      />
      <View style={styles.gap}>
        <TextField
          label="Fields"
          value={fieldText}
          onChangeText={setFieldText}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.fields}
        />
        <Text style={[typography.caption, { color: colors.mutedText }]}>One per line.</Text>
      </View>
      <ErrorText message={error} />
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button title={initial ? 'Save' : 'Create'} loading={saving} disabled={!name.trim()} onPress={save} />
        </View>
        <View style={styles.action}>
          <Button title="Cancel" variant="secondary" disabled={saving} onPress={() => router.back()} />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingBottom: spacing.xl },
  gap: { gap: spacing.xs },
  fields: { minHeight: 140, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: spacing.md },
  action: { flex: 1 },
});
