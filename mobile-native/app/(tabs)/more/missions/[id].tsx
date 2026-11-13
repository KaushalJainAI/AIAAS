import { useLocalSearchParams } from 'expo-router';

import { MissionDetailScreen } from '../../../../src/features/missions/MissionDetailScreen';

export default function MissionRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MissionDetailScreen missionId={Number(id)} />;
}
