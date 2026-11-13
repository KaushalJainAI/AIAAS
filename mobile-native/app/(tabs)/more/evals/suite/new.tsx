import { Stack, useRouter } from 'expo-router';

import { ErrorState } from '../../../../../src/components/ErrorState';
import { LoadingState } from '../../../../../src/components/LoadingState';
import { Screen } from '../../../../../src/components/Screen';
import { messageOf } from '../../../../../src/features/agents/format';
import { useAgents } from '../../../../../src/features/agents/queries';
import { SuiteForm } from '../../../../../src/features/evals/SuiteForm';
import { spacing, useTheme } from '../../../../../src/theme';
import { ScrollView } from 'react-native';

/** Create a suite. The judge and the cases come later; a new suite is only a name, an agent and a review policy. */
export default function NewSuiteScreen() {
  const router = useRouter();
  const agents = useAgents();
  const { spacing: s } = useTheme();

  let body;
  if (agents.isPending) {
    body = <LoadingState text="Loading agents" />;
  } else if (agents.isError) {
    body = <ErrorState message={messageOf(agents.error, 'Could not load your agents.')} onRetry={() => void agents.refetch()} />;
  } else {
    const options = (agents.data ?? []).filter((a) => a.status !== 'archived').map((a) => ({ id: a.id, name: a.name }));
    body = (
      <SuiteForm
        agents={options}
        onSaved={(suite) => router.replace(`/more/evals/suite/${suite.id}`)}
      />
    );
  }

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: 'New suite' }} />
      <ScrollView contentContainerStyle={{ gap: s.lg, paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
    </Screen>
  );
}
