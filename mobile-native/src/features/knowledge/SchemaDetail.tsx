import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorState } from '../../components/ErrorState';
import { ErrorText } from '../../components/ErrorText';
import { Icon } from '../../components/Icon';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { confirm } from '../../components/confirm';
import { warning } from '../../lib/haptics';
import { spacing, typography, useTheme } from '../../theme';
import { ExtractedRowCard } from './ExtractedRowCard';
import { ExtractSheet } from './ExtractSheet';
import { FilterChips } from './FilterChips';
import { Notice } from './Notice';
import { messageOf, percent, ROWS_PAGE_SIZE } from './format';
import { useRowReview } from './useRowReview';
import { useExtractionSchema, useRemoveSchema, useSchemaRows } from './queries';
import type { RowStatus } from './types';

type Filter = RowStatus | '';

const FILTERS: { id: Filter; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'needs_review', label: 'Needs review' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'reviewed', label: 'Reviewed' },
  { id: 'rejected', label: 'Rejected' },
];

/**
 * One schema: its fields, the rows it produced (filtered by status, paged), the
 * "Extract from documents" run, and delete. Shown as the web's schema panel.
 */
export function SchemaDetail({ id }: { id: number }) {
  const router = useRouter();
  const { colors } = useTheme();
  const schema = useExtractionSchema(id);
  const [filter, setFilter] = useState<Filter>('needs_review');
  const [page, setPage] = useState(1);
  const rows = useSchemaRows(id, { status: filter || undefined, page });
  const review = useRowReview();
  const remove = useRemoveSchema();
  const [extracting, setExtracting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  if (schema.isPending) return <LoadingState text="Loading schema" />;
  if (schema.isError) {
    return <ErrorState message={messageOf(schema.error, 'This schema could not be loaded.')} onRetry={() => void schema.refetch()} />;
  }
  const s = schema.data;
  const names = s.fields.map((f) => f.name);
  const count = rows.data?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(count / ROWS_PAGE_SIZE));

  const pickFilter = (next: Filter) => {
    setFilter(next);
    setPage(1);
  };

  const removeSchema = () => {
    void confirm({
      title: `Delete "${s.name}"?`,
      message: 'Its extracted rows go with it.',
      destructiveLabel: 'Delete',
    }).then((ok) => {
      if (!ok) return;
      setRemoveError(null);
      remove.mutate(s.id, {
        onSuccess: () => {
          warning();
          router.back();
        },
        onError: (e) => setRemoveError(messageOf(e, 'Could not delete that schema.')),
      });
    });
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={[typography.heading, { color: colors.text }]}>{s.name}</Text>
          <Text style={[typography.caption, { color: colors.mutedText, marginTop: spacing.xs }]}>
            {s.field_count} fields · rows held below {percent(s.confidence_threshold)} confidence
          </Text>
          <Text style={[typography.body, { color: colors.text, marginTop: spacing.sm }]}>
            {names.length ? names.join(', ') : 'No fields yet.'}
          </Text>
        </Card>

        <View style={styles.actions}>
          <View style={styles.action}>
            <Button title="Extract from documents" onPress={() => setExtracting(true)} />
          </View>
          <View style={styles.action}>
            <Button
              title="Edit"
              variant="secondary"
              onPress={() => router.push(`/more/knowledge/schema/edit?id=${s.id}`)}
            />
          </View>
        </View>
        <Notice text={notice} />

        <FilterChips
          items={FILTERS.map((f) => ({
            key: f.id,
            label: f.label,
            count: f.id === 'needs_review' ? s.review_count : undefined,
          }))}
          value={filter}
          onChange={pickFilter}
        />

        {rows.isPending ? (
          <LoadingState text="Loading rows" />
        ) : rows.isError ? (
          <ErrorState message={messageOf(rows.error, 'The rows could not be loaded.')} onRetry={() => void rows.refetch()} />
        ) : rows.data.results.length === 0 ? (
          <Card>
            <View style={styles.empty}>
              <Icon name="checkmark-circle-outline" size={18} color={colors.success} />
              <Text style={[typography.body, { color: colors.mutedText }]}>
                {filter === 'needs_review' ? 'Nothing waiting on you.' : 'No rows here yet.'}
              </Text>
            </View>
          </Card>
        ) : (
          <View style={styles.rows}>
            {rows.data.results.map((row) => (
              <ExtractedRowCard
                key={row.id}
                row={row}
                names={names.length ? names : undefined}
                threshold={s.confidence_threshold}
                busy={review.busy}
                actions={review.actions}
              />
            ))}
          </View>
        )}

        {pageCount > 1 ? (
          <View style={styles.pager}>
            <View style={styles.action}>
              <Button title="Previous" variant="secondary" disabled={!rows.data?.previous} onPress={() => setPage((p) => p - 1)} />
            </View>
            <Text style={[typography.caption, { color: colors.mutedText }]}>
              Page {page} of {pageCount}
            </Text>
            <View style={styles.action}>
              <Button title="Next" variant="secondary" disabled={!rows.data?.next} onPress={() => setPage((p) => p + 1)} />
            </View>
          </View>
        ) : null}

        <ErrorText message={review.error} />
        <Notice text={review.notice} />

        <Section title="Schema">
          <ListRow
            icon="trash-outline"
            title="Delete schema"
            destructive
            chevron={false}
            disabled={remove.isPending}
            onPress={removeSchema}
          />
        </Section>
        <ErrorText message={removeError} />
      </ScrollView>

      {extracting ? (
        <ExtractSheet
          schemaId={s.id}
          schemaName={s.name}
          threshold={s.confidence_threshold}
          onClose={() => setExtracting(false)}
          onDone={(message) => {
            setExtracting(false);
            setNotice(message);
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingBottom: spacing.xl },
  actions: { flexDirection: 'row', gap: spacing.md },
  action: { flex: 1 },
  empty: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rows: { gap: spacing.md },
  pager: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
