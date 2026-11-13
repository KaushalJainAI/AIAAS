import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { ActionSheet, type SheetAction } from './ActionSheet';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Icon } from '../../components/Icon';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { SearchBar } from '../../components/SearchBar';
import { Text } from '../../components/Text';
import { success } from '../../lib/haptics';
import { fontSize, spacing, useTheme } from '../../theme';
import { useRefresh } from '../../hooks/useRefresh';
import { Crumbs, type Crumb } from './Crumbs';
import { FileActions, type FileTarget } from './FileActions';
import { FOLDER_ICON, fileIcon } from './icons';
import { NameSheet } from './NameSheet';
import { NoticeBar, useNotice } from './notice';
import { useOpenFile } from './open';
import { EntryRow } from './EntryRow';
import { SEARCH_DEBOUNCE_MS, errorMessage, handoff, isStorageFull, plural, useDebounced } from './helpers';
import { NEW_FILES, newFileName } from './newFiles';
import { pickFiles, pickPhotos } from './pick';
import { DEFAULT_SORT, SORT_LABEL, entryKey, entryName, nextSort, sortEntries, type Entry, type SortKey, type SortState } from './sort';
import { searchSections } from './search';
import {
  flattenDocuments,
  useCreateDocument,
  useCreateFolder,
  useDocumentList,
  useDocumentSearch,
  useFolderList,
  useStorage,
  useUploadDocument,
} from './queries';
import { StorageMeter } from './StorageMeter';
import type { NewFileOption } from '../apps/catalogue';
import type { Folder } from './types';
import type { UploadFile } from './upload';

type Creating = { kind: 'folder' } | { kind: 'file'; opt: NewFileOption };

const SORT_KEYS: SortKey[] = ['name', 'modified', 'type', 'size'];

interface Props {
  /** `null` is the user's root. */
  folderId: number | null;
}

/**
 * The file browser: a folder's contents, search over names and text, New and
 * Upload, and each item's actions. Mirrors `pages/Documents.tsx`, one column
 * wide. Folders are their own route, so Android back walks up the tree.
 */
export function FolderScreen({ folderId }: Props) {
  const router = useRouter();
  const { colors } = useTheme();
  const openFile = useOpenFile();
  const { notice, show, dismiss } = useNotice();

  const [query, setQuery] = useState('');
  const [everywhere, setEverywhere] = useState(false);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [addOpen, setAddOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [creating, setCreating] = useState<Creating | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [target, setTarget] = useState<FileTarget | null>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);

  const trimmed = query.trim();
  const mode: 'browse' | 'filter' | 'search' = trimmed.length === 0 ? 'browse' : trimmed.length === 1 ? 'filter' : 'search';
  const debounced = useDebounced(trimmed, SEARCH_DEBOUNCE_MS);

  const listing = useFolderList(folderId);
  const docs = useDocumentList({ scope: 'personal', folder_id: folderId ?? 'root', limit: 100 });
  const storage = useStorage();
  const search = useDocumentSearch({
    q: debounced,
    scope: 'personal',
    folder_id: folderId !== null && !everywhere ? folderId : undefined,
    limit: 100,
  });

  const createFolder = useCreateFolder(folderId);
  const createDocument = useCreateDocument(folderId);
  const upload = useUploadDocument(folderId);

  const folder: Folder | null = listing.data?.folder ?? null;
  const title = folderId === null ? 'Files' : (folder?.name ?? 'Folder');
  const crumbs: Crumb[] = [
    { id: null, name: 'Home' },
    ...(listing.data?.breadcrumbs ?? []),
    ...(folder ? [{ id: folder.id, name: folder.name }] : []),
  ];

  const refetch = useCallback(
    () => Promise.all([listing.refetch(), docs.refetch(), storage.refetch()]),
    [listing, docs, storage],
  );
  const { refreshing, onRefresh } = useRefresh(refetch);

  // ---- What is on screen --------------------------------------------------
  const folderEntries: Entry[] = (listing.data?.folders ?? []).map((f) => ({ kind: 'folder', folder: f }));
  const fileEntries: Entry[] = flattenDocuments(docs.data?.pages).map((doc) => ({ kind: 'file', doc }));
  const needle = trimmed.toLowerCase();
  // One character filters what is on screen; two or more ask the server (as the web does).
  const browse = sortEntries(
    [...folderEntries, ...fileEntries].filter((e) => mode !== 'filter' || entryName(e).toLowerCase().includes(needle)),
    sort,
  );
  const sections = searchSections(search.data);
  const hits = mode === 'search' ? sections.exact.length + sections.fuzzy.length : browse.length;
  const showSearching = mode === 'search' && debounced.length >= 2;

  // ---- Navigation ---------------------------------------------------------
  const openFolder = (id: number) => router.push(`/files/folder/${id}`);
  const goTo = (id: number | null) => {
    if (id === null) router.dismissTo('/files');
    else router.dismissTo(`/files/folder/${id}`);
  };

  const openEntry = (entry: Entry) => {
    if (entry.kind === 'folder') return openFolder(entry.folder.id);
    if (openFile(entry.doc) === 'none') setTarget({ kind: 'file', doc: entry.doc });
  };

  // ---- Creating and uploading --------------------------------------------
  const submitCreate = async (name: string) => {
    if (!creating) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      if (creating.kind === 'folder') {
        const made = await createFolder.mutateAsync(name);
        success();
        setCreating(null);
        show(`Created “${made.name}”`);
      } else {
        const doc = await createDocument.mutateAsync({
          name: newFileName(name, creating.opt.ext),
          content: creating.opt.content,
        });
        success();
        setCreating(null);
        openFile(doc);
      }
    } catch (err) {
      setCreateError(errorMessage(err, 'Could not create. Please try again.'));
    } finally {
      setCreateBusy(false);
    }
  };

  const uploadFiles = async (picked: UploadFile[]) => {
    if (!picked.length) return;
    let done = 0;
    let failure: string | null = null;
    for (let i = 0; i < picked.length; i += 1) {
      setUploading({ done: i, total: picked.length });
      try {
        await upload.mutateAsync(picked[i]);
        done += 1;
      } catch (err) {
        if (isStorageFull(err)) {
          failure = 'Storage is full. Empty the Trash or delete some files.';
          break;
        }
        failure = `Could not upload ${picked[i].name}. ${errorMessage(err, 'Please try again.')}`;
      }
    }
    setUploading(null);
    if (done) {
      success();
      show(`Uploaded ${plural(done, 'file')}`);
    }
    if (failure) show(failure, 'danger');
  };

  /** Closes the add sheet, then runs `next` once it has left. */
  const after = (next: () => void) => {
    setAddOpen(false);
    handoff(next);
  };

  const addActions: SheetAction[] = [
    { key: 'folder', label: 'Folder', icon: FOLDER_ICON, onPress: () => after(() => setCreating({ kind: 'folder' })) },
    ...NEW_FILES.map((opt) => ({
      key: `new-${opt.ext}`,
      label: opt.label,
      icon: fileIcon({ filename: `x.${opt.ext}`, file_type: opt.ext }),
      onPress: () => after(() => setCreating({ kind: 'file', opt })),
    })),
    { key: 'upload', label: 'Upload files…', icon: 'cloud-upload-outline', onPress: () => after(() => void pickFiles().then(uploadFiles)) },
    { key: 'photos', label: 'Upload photos…', icon: 'images-outline', onPress: () => after(() => void pickPhotos().then(uploadFiles)) },
  ];

  const sortActions: SheetAction[] = SORT_KEYS.map((key) => ({
    key,
    label: SORT_LABEL[key],
    icon: 'swap-vertical-outline',
    detail: sort.key === key ? (sort.dir === 'asc' ? 'Ascending' : 'Descending') : undefined,
    onPress: () => {
      setSort(nextSort(sort, key));
      setSortOpen(false);
    },
  }));

  // ---- Rendering helpers ---------------------------------------------------
  const listLoading = mode === 'search' ? showSearching && !search.data && search.isFetching : listing.isPending || docs.isPending;
  const listFailed = mode === 'search' ? showSearching && search.isError && !search.data : listing.isError || docs.isError;
  const failureText = mode === 'search'
    ? errorMessage(search.error, 'Search failed. Please try again.')
    : errorMessage(listing.error ?? docs.error, 'Could not load your files.');

  const renderEntries = (entries: Entry[], subtitles?: Map<string, string>) => (
    <Section>
      {entries.map((entry) => (
        <EntryRow
          key={entryKey(entry)}
          entry={entry}
          subtitle={subtitles?.get(entryKey(entry))}
          onOpen={() => openEntry(entry)}
          onMore={() => setTarget(entry.kind === 'folder' ? { kind: 'folder', folder: entry.folder } : { kind: 'file', doc: entry.doc })}
        />
      ))}
    </Section>
  );

  let body: ReactNode;
  if (listLoading) {
    body = <View style={styles.block}><LoadingState text={mode === 'search' ? 'Searching…' : 'Loading…'} /></View>;
  } else if (listFailed) {
    body = (
      <View style={styles.block}>
        <ErrorState message={failureText} onRetry={() => void onRefresh()} />
      </View>
    );
  } else if (mode === 'search') {
    body = (
      <>
        {sections.exact.length > 0 ? renderEntries(sections.exact, sections.subtitles) : null}
        {sections.fuzzy.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, { color: colors.mutedText }]}>
              {sections.exact.length ? 'Close matches' : `No exact matches — close matches for “${search.data?.query ?? trimmed}”`}
            </Text>
            {renderEntries(sections.fuzzy, sections.subtitles)}
          </>
        ) : null}
        {search.data?.note ? <Text style={[styles.note, { color: colors.mutedText }]}>{search.data.note}</Text> : null}
        {hits === 0 && showSearching ? (
          <View style={styles.block}>
            <EmptyState
              title={`No matches for “${trimmed}”`}
              message={trimmed.length < 2 ? 'Keep typing to search names and contents.' : 'No file name or file text matches, and nothing is close.'}
            />
          </View>
        ) : null}
      </>
    );
  } else if (browse.length === 0) {
    body = (
      <View style={styles.block}>
        {mode === 'filter' ? (
          <EmptyState title={`No matches for “${trimmed}”`} message="Keep typing to search names and contents." />
        ) : (
          <EmptyState title="This folder is empty." message="Upload a file, create a document, or add a folder." />
        )}
      </View>
    );
  } else {
    body = (
      <>
        {renderEntries(browse)}
        {docs.hasNextPage && mode === 'browse' ? (
          <Button
            title="Load more"
            variant="secondary"
            loading={docs.isFetchingNextPage}
            onPress={() => void docs.fetchNextPage()}
          />
        ) : null}
        {listing.data?.truncated ? (
          <Text style={[styles.note, { color: colors.mutedText }]}>{`Showing the first ${listing.data.count} folders here.`}</Text>
        ) : null}
      </>
    );
  }

  const itemCount = mode === 'search' ? (search.data?.count ?? 0) : browse.length;
  const sortLabel = SORT_LABEL[sort.key];

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New or upload"
              onPress={() => setAddOpen(true)}
              hitSlop={8}
              style={styles.headerButton}
            >
              <Icon name="add" size={26} color={colors.primary} />
            </Pressable>
          ),
        }}
      />

      <SearchBar value={query} onChangeText={setQuery} placeholder={`Search ${title}`} />

      <View style={styles.crumbs}>
        <Crumbs items={crumbs} onPress={goTo} />
      </View>

      <NoticeBar notice={notice} onDismiss={dismiss} />

      <ScrollView
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {folderId === null && mode === 'browse' ? (
          <>
            <Section>
              <ListRow title="Recent" icon="time-outline" chevron onPress={() => router.push('/files/recent')} />
              <ListRow title="Trash" icon="trash-outline" chevron onPress={() => router.push('/files/trash')} />
            </Section>
            <StorageMeter onOpenTrash={() => router.push('/files/trash')} />
          </>
        ) : null}

        {mode === 'search' ? (
          <View style={styles.searchInfo}>
            <Text style={{ color: colors.mutedText, fontSize: fontSize.sm, flex: 1 }}>
              {folderId === null || everywhere
                ? `Searching all your files${search.isFetching ? '…' : '.'}`
                : `Searching ${title} and its subfolders${search.isFetching ? '…' : '.'}`}
            </Text>
            {folderId !== null ? (
              <Pressable accessibilityRole="button" onPress={() => setEverywhere((v) => !v)} style={styles.textButton}>
                <Text style={{ color: colors.primary, fontSize: fontSize.sm }}>
                  {everywhere ? `Only ${title}` : 'Search all files'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : mode === 'filter' ? (
          <Text style={[styles.note, { color: colors.mutedText }]}>
            Showing matching names here. Type another letter to search names and contents.
          </Text>
        ) : null}

        <View style={styles.statusRow}>
          <Text style={{ color: colors.mutedText, fontSize: fontSize.sm }}>
            {uploading
              ? `Uploading ${uploading.done + 1} of ${uploading.total}…`
              : `${itemCount.toLocaleString()} ${itemCount === 1 ? 'item' : 'items'}`}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Sort by ${sortLabel}`} onPress={() => setSortOpen(true)} style={styles.textButton}>
            <Icon name="swap-vertical-outline" size={16} color={colors.primary} />
            <Text style={{ color: colors.primary, fontSize: fontSize.sm, marginLeft: spacing.xs }}>{`Sort: ${sortLabel}`}</Text>
          </Pressable>
        </View>

        {body}
      </ScrollView>

      {addOpen ? <ActionSheet title="New" actions={addActions} onClose={() => setAddOpen(false)} /> : null}

      {sortOpen ? <ActionSheet title="Sort by" actions={sortActions} onClose={() => setSortOpen(false)} /> : null}

      {creating ? (
        <NameSheet
          title={creating.kind === 'folder' ? 'New folder' : `New ${creating.opt.label.toLowerCase()}`}
          initial={creating.kind === 'folder' ? 'New folder' : `Untitled.${creating.opt.ext}`}
          submitLabel="Create"
          busy={createBusy}
          error={createError}
          onSubmit={(name) => void submitCreate(name)}
          onClose={() => {
            setCreating(null);
            setCreateError(null);
          }}
        />
      ) : null}

      {target ? (
        <FileActions target={target} onClose={() => setTarget(null)} notify={show} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  crumbs: { marginTop: spacing.sm },
  scroll: { flex: 1, marginTop: spacing.xs },
  content: { gap: spacing.md, paddingBottom: spacing.xxl },
  block: { minHeight: 240 },
  sectionLabel: { fontSize: fontSize.sm, marginTop: spacing.sm },
  note: { fontSize: fontSize.sm, lineHeight: 16 },
  searchInfo: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
  textButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
