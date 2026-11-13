import { useLocalSearchParams } from 'expo-router';

import { EmptyState } from '../../../../src/components/EmptyState';
import { Screen } from '../../../../src/components/Screen';
import { ConnectionDetailScreen } from '../../../../src/features/connections/ConnectionDetailScreen';
import { idParam } from '../../../../src/features/settings/params';

export default function ConnectionRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = idParam(params.id);
  if (id === null) {
    return (
      <Screen edges={['left', 'right']}>
        <EmptyState title="Not available" message="This connection link is not valid." />
      </Screen>
    );
  }
  return <ConnectionDetailScreen id={id} />;
}
