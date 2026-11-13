import { useLocalSearchParams } from 'expo-router';

import { Screen } from '../../../../src/components/Screen';
import { SolutionScreen } from '../../../../src/features/team/SolutionScreen';
import { scopeOfParam } from '../../../../src/features/team/page';

export default function SolutionRoute() {
  const params = useLocalSearchParams<{ id: string; org?: string }>();
  const id = Number(Array.isArray(params.id) ? params.id[0] : params.id);
  const org = scopeOfParam(Array.isArray(params.org) ? params.org[0] : params.org);
  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <SolutionScreen id={id} org={org} />
    </Screen>
  );
}
