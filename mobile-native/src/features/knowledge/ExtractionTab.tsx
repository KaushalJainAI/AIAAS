import { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorState } from '../../components/ErrorState';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { useRefresh } from '../../hooks/useRefresh';
import { spacing, typography, useTheme } from '../../theme';
import { SOURCE_LABEL, messageOf } from './format';
import { useExtractionSchemas } from './queries';

/**
 * Extraction schemas: the columns a person wants filled from documents. Each one
 * opens to its rows; rows held for review are counted at the top, as the web does.
 */
export function ExtractionTab() {
  const router = useRouter();
  const { colors } = useTheme();
  const schemas = useExtractionSchemas();
  const refetch = useCallback(() => schemas.refetch(), [schemas]);
  const { refreshing, onRefresh } = useRefresh(refetch);

  if (schemas.isPending) return <LoadingState text="Loading schemas" />;
  if (schemas.isError) {
    return <ErrorState message={messageOf(schemas.error, 'Schemas could not be loaded.')} onRetry={() => void schemas.refetch()} />;
  }

  const items = schemas.data.items;
  const waiting = items.reduce((n, s) => n + s.review_count, 0);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Button title="New schema" onPress={() => router.push('/more/knowledge/schema/edit')} />

      {items.length === 0 ? (
        <Card>
          <Text style={[typography.heading, { color: colors.text }]}>No schemas yet</Text>
          <Text style={[typography.body, { color: colors.mutedText, marginTop: spacing.sm }]}>
            A schema is the set of columns you want filled. Define it once, point it at a folder or an inbox, and
            anything the model is unsure about gets held for you rather than guessed.
          </Text>
        </Card>
      ) : (
        <>
          {waiting > 0 ? (
            <Section>
              <ListRow
                icon="warning-outline"
                title={`${waiting} row${waiting === 1 ? '' : 's'} waiting on you`}
                subtitle="Review them in the review queue"
                destructive
                onPress={() => router.push('/more/knowledge/review')}
              />
            </Section>
          ) : null}

          <Section title="Schemas">
            {items.map((s) => (
              <ListRow
                key={s.id}
                icon="scan-outline"
                title={s.name}
                subtitle={`${s.field_count} fields · ${s.row_count.toLocaleString()} rows · ${SOURCE_LABEL[s.source_kind]}`}
                detail={s.review_count > 0 ? `${s.review_count} need${s.review_count === 1 ? 's' : ''} review` : 'Nothing waiting'}
                onPress={() => router.push(`/more/knowledge/schema/${s.id}`)}
              />
            ))}
          </Section>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl, paddingBottom: spacing.xl },
});
