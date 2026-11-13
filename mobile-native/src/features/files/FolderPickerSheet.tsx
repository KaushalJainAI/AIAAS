import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Section } from '../../components/Section';
import { Sheet } from '../../components/Sheet';
import { spacing } from '../../theme';
import { Crumbs, type Crumb } from './Crumbs';
import { FOLDER_ICON } from './icons';
import { useFolderList } from './queries';
import { plural } from './helpers';

interface Props {
  title: string;
  confirmLabel: string;
  /** Folders that cannot be picked: the folder being moved. */
  excludeIds?: number[];
  busy?: boolean;
  /** The chosen folder, or `null` for the user's root. */
  onPick: (folderId: number | null) => void;
  onClose: () => void;
}

/** Pick a destination by walking into folders, as the web's folder picker does. Mount it only while open. */
export function FolderPickerSheet({ title, confirmLabel, excludeIds = [], busy = false, onPick, onClose }: Props) {
  const [browsing, setBrowsing] = useState<number | null>(null);
  const page = useFolderList(browsing);
  const excluded = new Set(excludeIds);

  const trail: Crumb[] = [
    { id: null, name: 'My Files' },
    ...(page.data?.breadcrumbs ?? []),
    ...(page.data?.folder ? [{ id: page.data.folder.id, name: page.data.folder.name }] : []),
  ];

  return (
    <Sheet visible onClose={onClose} title={title}>
      <View style={{ marginBottom: spacing.sm }}>
        <Crumbs items={trail} onPress={setBrowsing} />
      </View>
      <ScrollView style={{ maxHeight: 360 }}>
        {page.isPending ? (
          <View style={{ minHeight: 160 }}>
            <LoadingState />
          </View>
        ) : page.isError ? (
          <View style={{ minHeight: 200 }}>
            <ErrorState message="This folder could not be loaded." onRetry={() => void page.refetch()} />
          </View>
        ) : page.data && page.data.folders.length > 0 ? (
          <Section>
            {page.data.folders.map((folder) => {
              const blocked = excluded.has(folder.id);
              return (
                <ListRow
                  key={folder.id}
                  title={folder.name}
                  subtitle={`${plural(folder.document_count, 'file')} · ${plural(folder.child_count, 'folder')}`}
                  icon={FOLDER_ICON}
                  disabled={blocked}
                  onPress={() => setBrowsing(folder.id)}
                />
              );
            })}
          </Section>
        ) : (
          <View style={{ minHeight: 160 }}>
            <EmptyState title="No folders here" message="Pick this folder, or go back." />
          </View>
        )}
      </ScrollView>
      <View style={{ marginTop: spacing.lg }}>
        <Button title={confirmLabel} onPress={() => onPick(browsing)} loading={busy} disabled={busy} />
      </View>
    </Sheet>
  );
}
