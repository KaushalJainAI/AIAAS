import { ScrollView } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '../../../../../src/components/Screen';
import { CaseForm } from '../../../../../src/features/evals/CaseForm';
import { spacing, useTheme } from '../../../../../src/theme';

/** Write a case by hand. It is saved active: the person's own case, scored in the next sweep. */
export default function NewCaseScreen() {
  const { suiteId: rawSuite = '' } = useLocalSearchParams<{ suiteId: string }>();
  const suiteId = Number(rawSuite);
  const router = useRouter();
  const { spacing: s } = useTheme();

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: 'New case' }} />
      <ScrollView contentContainerStyle={{ gap: s.lg, paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
        {Number.isFinite(suiteId) ? <CaseForm suiteId={suiteId} onDone={() => router.back()} /> : null}
      </ScrollView>
    </Screen>
  );
}
