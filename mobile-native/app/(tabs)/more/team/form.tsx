import { useLocalSearchParams } from 'expo-router';

import { Screen } from '../../../../src/components/Screen';
import { SolutionFormScreen } from '../../../../src/features/team/SolutionFormScreen';
import { scopeOfParam } from '../../../../src/features/team/page';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function SolutionFormRoute() {
  const params = useLocalSearchParams<{ org?: string; id?: string; problem?: string }>();
  const idParam = first(params.id);
  const id = idParam === undefined ? null : Number(idParam);
  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <SolutionFormScreen
        org={scopeOfParam(first(params.org))}
        id={id == null || !Number.isFinite(id) ? null : id}
        problem={first(params.problem)?.slice(0, 500)}
      />
    </Screen>
  );
}
