import { Stack } from 'expo-router';

import { MissionsScreen } from '../../../../src/features/missions/MissionsScreen';

export default function MissionsRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Missions' }} />
      <MissionsScreen />
    </>
  );
}
