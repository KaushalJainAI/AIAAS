import { useLocalSearchParams } from 'expo-router';

import { AgentHistoryScreen } from '../../../../src/features/builder/screens/History';

export default function AgentHistoryRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <AgentHistoryScreen id={String(id ?? '')} />;
}
