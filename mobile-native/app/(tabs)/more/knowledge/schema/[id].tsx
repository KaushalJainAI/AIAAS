import { useLocalSearchParams, Stack } from 'expo-router';

import { Screen } from '../../../../../src/components/Screen';
import { SchemaDetail } from '../../../../../src/features/knowledge/SchemaDetail';

export default function SchemaRoute() {
  const raw = useLocalSearchParams<{ id: string }>().id;
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: 'Schema' }} />
      <SchemaDetail id={id} />
    </Screen>
  );
}
