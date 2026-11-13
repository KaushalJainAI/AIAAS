import { useLocalSearchParams } from 'expo-router';

import { EmptyState } from '../../../../src/components/EmptyState';
import { Screen } from '../../../../src/components/Screen';
import { FilePreviewScreen } from '../../../../src/features/files/FilePreviewScreen';

/** One file, previewed in the app: `/files/file/<id>`. */
export default function FileRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const fileId = Number(id);
  if (!Number.isInteger(fileId) || fileId <= 0) {
    return (
      <Screen edges={['left', 'right']}>
        <EmptyState title="This file cannot be opened" message="The link does not point to a file." />
      </Screen>
    );
  }
  return <FilePreviewScreen id={fileId} />;
}
