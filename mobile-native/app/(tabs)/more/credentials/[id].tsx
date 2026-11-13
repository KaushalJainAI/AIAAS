import { useLocalSearchParams } from 'expo-router';

import { EmptyState } from '../../../../src/components/EmptyState';
import { Screen } from '../../../../src/components/Screen';
import { CredentialDetailScreen } from '../../../../src/features/credentials/CredentialDetailScreen';
import { idParam } from '../../../../src/features/settings/params';

export default function CredentialRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = idParam(params.id);
  if (id === null) {
    return (
      <Screen edges={['left', 'right']}>
        <EmptyState title="Not available" message="This credential link is not valid." />
      </Screen>
    );
  }
  return <CredentialDetailScreen id={id} />;
}
