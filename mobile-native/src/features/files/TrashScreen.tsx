import { useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';

import { Button } from '../../components/Button';
import { confirm } from '../../components/confirm';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Icon } from '../../components/Icon';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { success, warning } from '../../lib/haptics';
import { fontSize, pressedOpacity, spacing, useTheme } from '../../theme';
import { useRefresh } from '../../hooks/useRefresh';
import { formatDate, typeName } from './display';
import { FOLDER_ICON, fileIcon } from './icons';
import { errorMessage } from './helpers';
import { NoticeBar, useNotice } from './notice';
import { useEmptyTrash, useRestoreTrash, useTrash } from './queries';
import type { Document, Folder } from './types';

/** The recycle bin. Restoring puts an item back where it was; the Trash is emptied for good. Mirrors the web's Trash view. */
export function TrashScreen() {
  const { colors } = useTheme();
  const trash = useTrash();
  const restore = useRestoreTrash();
  const empty = useEmptyTrash();
  const { notice, show, dismiss } = useNotice();
  const [restoringKey, setRestoringKey] = useState<string | null>(null);
  const { refreshing, onRefresh } = useRefresh(trash.refetch);

  const folders: Folder[] = trash.data?.pages.flatMap((p) => p.folders) ?? [];
  const docs: Document[] = trash.data?.pages.flatMap((p) => p.documents) ?? [];
  const days = trash.data?.pages[0]?.purges_after_days ?? 30;
  const nothingHere = folders.length === 0 && docs.length === 0;

  const restoreOne = async (kind: 'folder' | 'document', id: number, name: string) => {
    const key = `${kind}${id}`;
    setRestoringKey(key);
    try {
      const result = await restore.mutateAsync(kind === 'folder' ? { folder_ids: [id] } : { document_ids: [id] });
      const refused = result.refused[0];
      if (refused) {
        show(
          refused.reason === 'parent_still_trashed'
            ? 'Restore the folder first. This item lives inside a folder that is also in Trash.'
            : 'That item could not be restored.',
          'danger',
        );
      } else {
        const renamed = result.restored.find((r) => r.renamed_to);
        success();
        show(renamed ? `A name was taken, so it came back as “${renamed.renamed_to}”.` : `Restored “${name}”`);
      }
    } catch (err) {
      show(errorMessage(err, 'Could not restore. Please try again.'), 'danger');
    } finally {
      setRestoringKey(null);
    }
  };

  const emptyTrash = async () => {
    const ok = await confirm({
      title: 'Empty Trash?',
      message: 'Permanently delete everything in Trash? This cannot be undone.',
      destructiveLabel: 'Empty Trash',
    });
    if (!ok) return;
    try {
      const result = await empty.mutateAsync();
      warning();
      show(`Removed ${result.purged_documents} file(s) and ${result.purged_folders} folder(s).`);
    } catch (err) {
      show(errorMessage(err, 'Could not empty Trash. Please try again.'), 'danger');
    }
  };

  let body: ReactNode;
  if (trash.isPending) body = <LoadingState text="Loading…" />;
  else if (trash.isError)
    body = <ErrorState message={errorMessage(trash.error, 'Could not load Trash.')} onRetry={() => void trash.refetch()} />;
  else if (nothingHere)
    body = <EmptyState title="Trash is empty." message="Deleted files and folders wait here until you restore them." />;
  else {
    const restoreButton = (onPress: () => void) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Restore"
        disabled={restoringKey !== null}
        onPress={onPress}
        style={({ pressed }) => [styles.restore, { opacity: pressed ? pressedOpacity : 1 }]}
      >
        <Icon name="arrow-undo-outline" size={16} color={colors.primary} />
        <Text style={{ color: colors.primary, fontSize: fontSize.md, fontWeight: '500', marginLeft: spacing.xs }}>Restore</Text>
      </Pressable>
    );
    body = (
      <>
        <Text style={{ color: colors.mutedText, fontSize: fontSize.sm }}>
          {`Items here are removed permanently after ${days} days.`}
        </Text>
        <Section>
          {folders.map((f) => (
            <ListRow
              key={`f${f.id}`}
              title={f.name}
              subtitle={`File folder · Deleted ${formatDate(f.deleted_at)}`}
              icon={FOLDER_ICON}
              chevron={false}
              detail={restoreButton(() => void restoreOne('folder', f.id, f.name))}
            />
          ))}
          {docs.map((d) => (
            <ListRow
              key={`d${d.id}`}
              title={d.filename || d.title}
              subtitle={`${typeName(d)} · Deleted ${formatDate(d.deleted_at)}`}
              icon={fileIcon(d)}
              chevron={false}
              detail={restoreButton(() => void restoreOne('document', d.id, d.filename || d.title))}
            />
          ))}
        </Section>
        {trash.hasNextPage ? (
          <Button title="Load more" variant="secondary" loading={trash.isFetchingNextPage} onPress={() => void trash.fetchNextPage()} />
        ) : null}
        <Section>
          <ListRow
            title="Empty Trash"
            icon="trash-outline"
            destructive
            chevron={false}
            onPress={() => void emptyTrash()}
          />
        </Section>
      </>
    );
  }

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: 'Trash' }} />
      <NoticeBar notice={notice} onDismiss={dismiss} />
      <ScrollView
        contentContainerStyle={[styles.content]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {body}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xxl, flexGrow: 1 },
  restore: { minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xs },
});
