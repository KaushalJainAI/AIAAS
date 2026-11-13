import { useLocalSearchParams } from 'expo-router';

import { EmptyState } from '../../../../src/components/EmptyState';
import { Screen } from '../../../../src/components/Screen';
import { FolderScreen } from '../../../../src/features/files/FolderScreen';

/** One folder: `/files/folder/<id>`. */
export default function FolderRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const folderId = Number(id);
  if (!Number.isInteger(folderId) || folderId <= 0) {
    return (
      <Screen edges={['left', 'right']}>
        <EmptyState title="This folder cannot be opened" message="The link does not point to a folder." />
      </Screen>
    );
  }
  return <FolderScreen folderId={folderId} />;
}
