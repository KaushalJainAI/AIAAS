import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { ErrorText } from '../../components/ErrorText';
import { Icon } from '../../components/Icon';
import { LoadingState } from '../../components/LoadingState';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { listDocuments } from '../files/api';
import type { Document } from '../files/types';
import { documentName } from '../knowledge/documents';
import { success } from '../../lib/haptics';
import { spacing, typography, useTheme } from '../../theme';
import { messageOf } from './form';
import { useImportSolutionDocument } from './queries';
import type { OrgScope } from './types';

/** The file types the importer reads text from (`solutions/importer.py`). */
const IMPORT_FILE_TYPES = 'md,txt,docx,pdf';

/** Files still uploading, or that failed to read, have nothing to import. */
function importable(doc: Document): boolean {
  return doc.status !== 'uploading' && doc.status !== 'failed';
}

/**
 * "Import from a document": pick one of your own files and ask the server to
 * read the fixes in it. They arrive as drafts, which nobody else sees until shared.
 */
export function ImportSheet({
  org,
  onClose,
  onStarted,
}: {
  org: OrgScope;
  onClose: () => void;
  onStarted: (message: string) => void;
}) {
  const { colors } = useTheme();
  const [filter, setFilter] = useState('');
  const files = useInfiniteQuery({
    queryKey: ['solutions', 'import-files'],
    queryFn: ({ pageParam }) =>
      listDocuments({ scope: 'personal', types: IMPORT_FILE_TYPES, limit: 30, my_cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => (page.my_has_more && page.my_next_cursor ? page.my_next_cursor : undefined),
  });
  const start = useImportSolutionDocument();

  const loaded = (files.data?.pages.flatMap((p) => p.my_documents) ?? []).filter(importable);
  const needle = filter.trim().toLowerCase();
  const shown = needle ? loaded.filter((doc) => documentName(doc).toLowerCase().includes(needle)) : loaded;

  const importFile = (doc: Document) => {
    start.mutate(
      { org, documentId: doc.id },
      {
        onSuccess: () => {
          success();
          onStarted("Importing. You'll get a notification when the drafts are ready.");
          onClose();
        },
      },
    );
  };

  return (
    <Sheet visible onClose={onClose} title="Import from a document">
      <View style={styles.body}>
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          Choose a file from your library. Each fix found in it is saved as a draft for you to review. Nothing is shared
          until you share it.
        </Text>

        {files.isPending ? <LoadingState text="Loading your files" /> : null}
        {files.isError ? <ErrorText message={messageOf(files.error, 'Your files could not be loaded.')} /> : null}

        {!files.isPending && !files.isError && loaded.length === 0 ? (
          <Text style={[typography.body, styles.centre, { color: colors.mutedText }]}>
            No Word, PDF, Markdown or text files in your library yet.
          </Text>
        ) : null}

        {loaded.length > 0 ? (
          <>
            <TextField label="Filter by name" value={filter} onChangeText={setFilter} placeholder="Filter by name" />
            {shown.length === 0 ? (
              <Text style={[typography.caption, styles.centre, { color: colors.mutedText }]}>No file matches that name.</Text>
            ) : (
              <ScrollView style={styles.list}>
                {shown.map((doc) => (
                  <View key={doc.id} style={[styles.row, { borderColor: colors.border }]}>
                    <Icon name="document-text-outline" size={20} color={colors.mutedText} />
                    <View style={styles.name}>
                      <Text style={[typography.body, { color: colors.text }]} numberOfLines={1}>
                        {documentName(doc)}
                      </Text>
                      <Text style={[typography.caption, { color: colors.mutedText }]} numberOfLines={1}>
                        {doc.file_type.toUpperCase()} · {doc.folder_path || 'Top level'}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Import from ${documentName(doc)}`}
                      disabled={start.isPending}
                      onPress={() => importFile(doc)}
                      style={({ pressed }) => [styles.importBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                    >
                      <Text style={[typography.label, { color: colors.text }]}>Import</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
            {files.hasNextPage ? (
              <Button
                title="Load more files"
                variant="secondary"
                loading={files.isFetchingNextPage}
                onPress={() => void files.fetchNextPage()}
              />
            ) : null}
          </>
        ) : null}

        <ErrorText message={start.isError ? messageOf(start.error, 'The import did not start. Please try again.') : null} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, paddingBottom: spacing.md },
  list: { maxHeight: 360 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.sm,
  },
  name: { flex: 1, gap: 2 },
  importBtn: { minHeight: 44, minWidth: 44, paddingHorizontal: spacing.md, justifyContent: 'center', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 6 },
  centre: { textAlign: 'center', paddingVertical: spacing.md },
});
