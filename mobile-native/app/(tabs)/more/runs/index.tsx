import { Stack } from 'expo-router';

import { RunsScreen } from '../../../../src/features/runs/RunsScreen';

export default function RunsRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Runs' }} />
      <RunsScreen />
    </>
  );
}
