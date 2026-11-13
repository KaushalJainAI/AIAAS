import { useLocalSearchParams } from 'expo-router';

import { Screen } from '../../../../src/components/Screen';
import { BaseDetail } from '../../../../src/features/knowledge/BaseDetail';

export default function KnowledgeBaseRoute() {
  const raw = useLocalSearchParams<{ id: string }>().id;
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <BaseDetail id={id} />
    </Screen>
  );
}
