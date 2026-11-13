import { ScrollView } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { ErrorState } from '../../../../../../src/components/ErrorState';
import { LoadingState } from '../../../../../../src/components/LoadingState';
import { Screen } from '../../../../../../src/components/Screen';
import { messageOf } from '../../../../../../src/features/agents/format';
import { useAgents } from '../../../../../../src/features/agents/queries';
import { SuiteForm } from '../../../../../../src/features/evals/SuiteForm';
import { useEvalSuite } from '../../../../../../src/features/evals/queries';
import { spacing, useTheme } from '../../../../../../src/theme';

/** Edit a suite's name, agent, review policy and pass mark. Its cases are edited one by one. */
export default function EditSuiteScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const suiteId = Number(id);
  const router = useRouter();
  const suite = useEvalSuite(suiteId);
  const agents = useAgents();
  const { spacing: s } = useTheme();

  let body;
  if (suite.isPending || agents.isPending) {
    body = <LoadingState text="Loading suite" />;
  } else if (suite.isError || !suite.data) {
    body = <ErrorState message={messageOf(suite.error, 'Could not load this suite.')} onRetry={() => void suite.refetch()} />;
  } else {
    const options = (agents.data ?? []).filter((a) => a.status !== 'archived').map((a) => ({ id: a.id, name: a.name }));
    body = (
      <SuiteForm
        key={suite.data.id}
        existing={suite.data}
        agents={options}
        onSaved={() => router.back()}
      />
    );
  }

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: 'Edit suite' }} />
      <ScrollView contentContainerStyle={{ gap: s.lg, paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
    </Screen>
  );
}
