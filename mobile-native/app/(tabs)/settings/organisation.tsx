import { useLocalSearchParams } from 'expo-router';

import { EmptyState } from '../../../src/components/EmptyState';
import { Screen } from '../../../src/components/Screen';
import { OrganisationScreen } from '../../../src/features/account/OrganisationScreen';
import { idParam } from '../../../src/features/settings/params';

export default function OrganisationRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = idParam(params.id);
  if (id === null) {
    return (
      <Screen edges={['left', 'right']}>
        <EmptyState title="Not available" message="This organisation link is not valid." />
      </Screen>
    );
  }
  return <OrganisationScreen id={id} />;
}
