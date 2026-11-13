import { useLocalSearchParams } from 'expo-router';

import { EmptyState } from '../../../../src/components/EmptyState';
import { Screen } from '../../../../src/components/Screen';
import { ShareScreen } from '../../../../src/features/connections/ShareScreen';
import { idParam, param } from '../../../../src/features/settings/params';
import type { CustomToolKind } from '../../../../src/features/connections/types';

export default function ShareRoute() {
  const params = useLocalSearchParams<{ kind?: string | string[]; id?: string | string[]; name?: string | string[] }>();
  const kind = param(params.kind);
  const id = idParam(params.id);
  if ((kind !== 'api' && kind !== 'data') || id === null) {
    return (
      <Screen edges={['left', 'right']}>
        <EmptyState title="Not available" message="This share link is not valid." />
      </Screen>
    );
  }
  return <ShareScreen kind={kind as CustomToolKind} id={id} name={param(params.name) ?? 'Tool'} />;
}
