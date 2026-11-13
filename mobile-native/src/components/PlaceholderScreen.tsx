import { Stack } from 'expo-router';

import { EmptyState } from './EmptyState';
import { Screen } from './Screen';

/** Stands in for a screen a later agent will build. Same title and empty look everywhere. */
export function PlaceholderScreen({ title, message = 'Coming next' }: { title: string; message?: string }) {
  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title }} />
      <EmptyState title={title} message={message} />
    </Screen>
  );
}
