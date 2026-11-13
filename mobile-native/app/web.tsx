import { Stack, useLocalSearchParams } from 'expo-router';

import { EmptyState } from '../src/components/EmptyState';
import { Screen } from '../src/components/Screen';
import { WebApp } from '../src/components/WebApp';
import { safePath } from '../src/lib/paths';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** `/web?path=/documents&title=Files` opens that web screen under a header. */
export default function WebScreen() {
  const params = useLocalSearchParams<{ path?: string | string[]; title?: string | string[] }>();
  const path = safePath(first(params.path));
  const title = first(params.title)?.slice(0, 60) || 'Web';

  return (
    <Screen edges={['left', 'right', 'bottom']} style={{ padding: 0 }}>
      <Stack.Screen options={{ headerShown: true, title }} />
      {path ? (
        <WebApp path={path} title={title} />
      ) : (
        <EmptyState title="This page cannot be opened" message="The link does not point to a page in the app." />
      )}
    </Screen>
  );
}
