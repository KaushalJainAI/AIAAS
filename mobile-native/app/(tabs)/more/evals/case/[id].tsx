import { ScrollView } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { ErrorState } from '../../../../../src/components/ErrorState';
import { LoadingState } from '../../../../../src/components/LoadingState';
import { Screen } from '../../../../../src/components/Screen';
import { messageOf } from '../../../../../src/features/agents/format';
import { CaseForm } from '../../../../../src/features/evals/CaseForm';
import { useEvalSuite } from '../../../../../src/features/evals/queries';
import { spacing, useTheme } from '../../../../../src/theme';

/**
 * Edit one case. The API has no single-case read, so the case is found in its suite.
 * A case from a test world keeps its expected answer and checks read-only.
 */
export default function EditCaseScreen() {
  const { id = '', suiteId: rawSuite = '' } = useLocalSearchParams<{ id: string; suiteId: string }>();
  const caseId = Number(id);
  const suiteId = Number(rawSuite);
  const router = useRouter();
  const suite = useEvalSuite(suiteId);
  const { spacing: s } = useTheme();

  let body;
  if (suite.isPending) {
    body = <LoadingState text="Loading case" />;
  } else if (suite.isError || !suite.data) {
    body = <ErrorState message={messageOf(suite.error, 'Could not load this case.')} onRetry={() => void suite.refetch()} />;
  } else {
    const existing = suite.data.cases.find((c) => c.id === caseId);
    body = existing ? (
      <CaseForm key={existing.id} suiteId={suiteId} existing={existing} onDone={() => router.back()} />
    ) : (
      <ErrorState title="Case not found" message="It may have been deleted." />
    );
  }

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: 'Edit case' }} />
      <ScrollView contentContainerStyle={{ gap: s.lg, paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
    </Screen>
  );
}
