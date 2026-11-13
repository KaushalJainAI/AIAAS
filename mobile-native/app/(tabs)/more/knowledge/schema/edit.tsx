import { useLocalSearchParams, Stack } from 'expo-router';

import { Screen } from '../../../../../src/components/Screen';
import { SchemaFormScreen } from '../../../../../src/features/knowledge/SchemaFormScreen';

export default function SchemaEditRoute() {
  const raw = useLocalSearchParams<{ id?: string }>().id;
  const id = raw === undefined ? null : Number(Array.isArray(raw) ? raw[0] : raw);
  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: id == null ? 'New schema' : 'Edit schema' }} />
      <SchemaFormScreen id={id == null || !Number.isFinite(id) ? null : id} />
    </Screen>
  );
}
