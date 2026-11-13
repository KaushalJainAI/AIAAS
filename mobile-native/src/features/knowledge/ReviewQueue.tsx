import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorState } from '../../components/ErrorState';
import { ErrorText } from '../../components/ErrorText';
import { Icon } from '../../components/Icon';
import { LoadingState } from '../../components/LoadingState';
import { Text } from '../../components/Text';
import { Badge } from '../../components/Badge';
import { useRefresh } from '../../hooks/useRefresh';
import { spacing, typography, useTheme } from '../../theme';
import { ExtractedRowCard } from './ExtractedRowCard';
import { Notice } from './Notice';
import { messageOf, ROWS_PAGE_SIZE } from './format';
import { useExtractionRows } from './queries';
import { useRowReview } from './useRowReview';

/**
 * Held rows across every schema: the web's review tab in the Inbox. Nothing here
 * is guessed; a person accepts, fixes or rejects each row.
 */
export function ReviewQueue() {
  const { colors } = useTheme();
  const [page, setPage] = useState(1);
  const rows = useExtractionRows({ status: 'needs_review', page });
  const review = useRowReview();
  const refetch = useCallback(() => rows.refetch(), [rows]);
  const { refreshing, onRefresh } = useRefresh(refetch);

  if (rows.isPending) return <LoadingState text="Loading held rows" />;
  if (rows.isError) {
    return <ErrorState message={messageOf(rows.error, 'Held rows could not be loaded.')} onRetry={() => void rows.refetch()} />;
  }

  const results = rows.data.results;
  const count = rows.data.count;
  const pageCount = Math.max(1, Math.ceil(count / ROWS_PAGE_SIZE));

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {results.length === 0 ? (
        <Card>
          <View style={styles.empty}>
            <Icon name="checkmark-circle-outline" size={22} color={colors.success} />
            <Text style={[typography.heading, { color: colors.text }]}>No held rows</Text>
            <Text style={[typography.body, { color: colors.mutedText, textAlign: 'center' }]}>
              When an extraction is below a schema’s confidence threshold it lands here for a person to clear. Nothing is
              waiting.
            </Text>
          </View>
        </Card>
      ) : (
        results.map((row) => (
          <View key={row.id} style={styles.item}>
            {row.schema_name ? <Badge label={row.schema_name} tone="neutral" /> : null}
            <ExtractedRowCard row={row} busy={review.busy} actions={review.actions} />
          </View>
        ))
      )}

      {pageCount > 1 ? (
        <View style={styles.pager}>
          <View style={styles.action}>
            <Button title="Previous" variant="secondary" disabled={!rows.data.previous} onPress={() => setPage((p) => p - 1)} />
          </View>
          <Text style={[typography.caption, { color: colors.mutedText }]}>
            Page {page} of {pageCount}
          </Text>
          <View style={styles.action}>
            <Button title="Next" variant="secondary" disabled={!rows.data.next} onPress={() => setPage((p) => p + 1)} />
          </View>
        </View>
      ) : null}

      <ErrorText message={review.error} />
      <Notice text={review.notice} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  item: { gap: spacing.xs },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  pager: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  action: { flex: 1 },
});
