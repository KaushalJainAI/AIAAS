import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorText } from '../../components/ErrorText';
import { Icon } from '../../components/Icon';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Markdown } from '../../components/Markdown';
import { Section } from '../../components/Section';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { tap } from '../../lib/haptics';
import { fontFamily, fontSize, radius, spacing, typography, useTheme } from '../../theme';
import { documentName } from './documents';
import { messageOf } from './format';
import { openDocument } from './openDocument';
import { useKnowledgeBases, usePersonalDocuments, useRagAsk, useRagSearch } from './queries';
import type { SearchResult } from '../files/types';

/** The text a search result shows: its first few hundred characters. */
const SNIPPET = 400;

/**
 * Search the person's knowledge bases for passages, or ask a question and get a
 * short answer with the passages it drew on. Search can be limited to one base;
 * Ask uses all of them, as the server does.
 */
export function SearchScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [kbId, setKbId] = useState<number | null>(null);
  const [kbSheet, setKbSheet] = useState(false);
  const mine = useKnowledgeBases(null);
  const files = usePersonalDocuments();
  const search = useRagSearch();
  const ask = useRagAsk();

  const ownKbs = (mine.data?.knowledge_bases ?? []).filter((kb) => kb.is_mine);
  const chosen = ownKbs.find((kb) => kb.id === kbId);
  const names = useMemo(() => {
    const map = new Map<number, string>();
    for (const doc of files.data?.documents ?? []) map.set(doc.id, documentName(doc));
    return map;
  }, [files.data]);

  const trimmed = query.trim();
  const busy = search.isPending || ask.isPending;

  const runSearch = () => {
    if (!trimmed) return;
    tap();
    ask.reset();
    search.mutate({ query: trimmed, kbId });
  };
  const runAsk = () => {
    if (!trimmed) return;
    tap();
    search.reset();
    ask.mutate(trimmed);
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.field}>
          <Text style={[typography.label, { color: colors.text }]}>Search or ask</Text>
          <TextInput
            accessibilityLabel="Search or ask"
            value={query}
            onChangeText={setQuery}
            placeholder="Type words to find, or ask a question"
            placeholderTextColor={colors.mutedText}
            multiline
            autoCapitalize="sentences"
            returnKeyType="search"
            onSubmitEditing={runSearch}
            style={[
              styles.input,
              {
                color: colors.text,
                backgroundColor: colors.inputBackground,
                borderColor: colors.borderStrong,
                borderRadius: radius.md,
                fontSize: fontSize.md,
                fontFamily: fontFamily.regular,
              },
            ]}
          />
        </View>

        <Section>
          <ListRow
            icon="library-outline"
            title="Knowledge base"
            detail={chosen ? chosen.name : 'All your knowledge bases'}
            onPress={() => setKbSheet(true)}
          />
        </Section>
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          Search looks in the knowledge base you pick. Ask uses all of them.
        </Text>

        <View style={styles.actions}>
          <View style={styles.action}>
            <Button title="Search" loading={search.isPending} disabled={!trimmed || busy} onPress={runSearch} />
          </View>
          <View style={styles.action}>
            <Button title="Ask" variant="secondary" loading={ask.isPending} disabled={!trimmed || busy} onPress={runAsk} />
          </View>
        </View>

        {search.isPending ? <LoadingState text="Searching" /> : null}
        <ErrorText message={search.isError ? messageOf(search.error, 'The search did not run.') : null} />
        {search.data ? (
          <Section title={`Results (${search.data.results.length})`}>
            {search.data.results.length === 0 ? (
              <Card>
                <Text style={[typography.body, { color: colors.mutedText }]}>Nothing matched. Try other words.</Text>
              </Card>
            ) : (
              search.data.results.map((hit, index) => (
                <ResultCard key={`${hit.document_id}-${index}`} hit={hit} name={names.get(hit.document_id)} router={router} />
              ))
            )}
          </Section>
        ) : null}

        {ask.isPending ? <LoadingState text="Thinking" /> : null}
        <ErrorText message={ask.isError ? messageOf(ask.error, 'The question did not get an answer.') : null} />
        {ask.data ? (
          <>
            <Card>
              {ask.data.answer.trim() ? (
                <Markdown text={ask.data.answer} />
              ) : (
                <Text style={[typography.body, { color: colors.mutedText }]}>No answer came back. Try a shorter question.</Text>
              )}
            </Card>
            {ask.data.sources.length > 0 ? (
              <Section title="Sources">
                {ask.data.sources.map((hit, index) => (
                  <ListRow
                    key={`${hit.document_id}-${index}`}
                    icon="document-text-outline"
                    title={names.get(hit.document_id) ?? (hit.source === 'platform' ? 'Shared library' : `Document ${hit.document_id}`)}
                    subtitle={hit.content.slice(0, SNIPPET)}
                    onPress={hit.source === 'personal' ? () => openDocument(router, hit.document_id, names.get(hit.document_id) ?? 'Document') : undefined}
                  />
                ))}
              </Section>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <Sheet visible={kbSheet} onClose={() => setKbSheet(false)} title="Knowledge base">
        <ListRow
          title="All your knowledge bases"
          chevron={false}
          detail={kbId === null ? <Icon name="checkmark" size={18} color={colors.primary} /> : undefined}
          onPress={() => {
            setKbId(null);
            setKbSheet(false);
          }}
        />
        {ownKbs.map((kb) => (
          <ListRow
            key={kb.id}
            title={kb.name}
            chevron={false}
            detail={kbId === kb.id ? <Icon name="checkmark" size={18} color={colors.primary} /> : undefined}
            onPress={() => {
              setKbId(kb.id);
              setKbSheet(false);
            }}
          />
        ))}
      </Sheet>
    </>
  );
}

function ResultCard({
  hit,
  name,
  router,
}: {
  hit: SearchResult;
  name: string | undefined;
  router: ReturnType<typeof useRouter>;
}) {
  const { colors } = useTheme();
  const title = name ?? (hit.source === 'platform' ? 'Shared library' : `Document ${hit.document_id}`);
  return (
    <Card>
      <View style={styles.resultHead}>
        <Text style={[typography.label, { color: colors.text, flex: 1 }]}>{title}</Text>
        <Text style={[typography.caption, { color: colors.mutedText }]}>Score {hit.score.toFixed(2)}</Text>
      </View>
      <Text numberOfLines={6} style={[typography.body, { color: colors.text, marginTop: spacing.sm }]}>
        {hit.content.slice(0, SNIPPET)}
      </Text>
      {hit.source === 'personal' ? (
        <View style={styles.resultFoot}>
          <Button
            title="Open file"
            variant="secondary"
            onPress={() => openDocument(router, hit.document_id, title)}
          />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingBottom: spacing.xl },
  field: { gap: spacing.xs },
  input: {
    minHeight: 96,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', gap: spacing.md },
  action: { flex: 1 },
  resultHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  resultFoot: { marginTop: spacing.md },
});
