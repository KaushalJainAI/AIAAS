import { useLocalSearchParams } from 'expo-router';

import { RunDetailScreen } from '../../../../src/features/runs/RunDetailScreen';

export default function RunRoute() {
  const { executionId } = useLocalSearchParams<{ executionId: string }>();
  return <RunDetailScreen executionId={String(executionId ?? '')} />;
}
