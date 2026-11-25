import { useLocalSearchParams } from 'expo-router';

import { ChangesScreen } from '../../../../src/features/changes/ChangesScreen';

/** The changes one chat answer or run made, and putting them back: `/chat/changes/<set id>`. */
export default function ChangesRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChangesScreen setId={Number(id)} />;
}
