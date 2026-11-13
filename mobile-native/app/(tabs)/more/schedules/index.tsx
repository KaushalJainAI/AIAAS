import { Stack } from 'expo-router';

import { SchedulesScreen } from '../../../../src/features/schedules/SchedulesScreen';

export default function SchedulesRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Schedules' }} />
      <SchedulesScreen />
    </>
  );
}
