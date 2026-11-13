import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Button } from '../../../../../src/components/Button';
import { Card } from '../../../../../src/components/Card';
import { ErrorState } from '../../../../../src/components/ErrorState';
import { ErrorText } from '../../../../../src/components/ErrorText';
import { LoadingState } from '../../../../../src/components/LoadingState';
import { Screen } from '../../../../../src/components/Screen';
import { Text } from '../../../../../src/components/Text';
import { confirm } from '../../../../../src/components/confirm';
import { messageOf } from '../../../../../src/features/agents/format';
import { ChangedList, IntentList, ReviewItem, RunStatusPill, ScoreText } from '../../../../../src/features/evals/Parts';
import { isLiveRun } from '../../../../../src/features/evals/format';
import {
  useCancelRun,
  useDeleteRun,
  useEvalReviewQueue,
  useEvalRun,
  useSubmitReview,
} from '../../../../../src/features/evals/queries';
import type { EvalResult, Verdict } from '../../../../../src/features/evals/types';
import { useRefresh } from '../../../../../src/hooks/useRefresh';
import { success, warning } from '../../../../../src/lib/haptics';
import { spacing, typography, useTheme } from '../../../../../src/theme';
import { GroupHeader } from '../../../../../src/features/explore/GroupHeader';

/** One sweep: its status, its provisional score until reviews are answered, and every result. */
export default function EvalRunScreen() {
  const { runId = '' } = useLocalSearchParams<{ runId: string }>();
  const router = useRouter();
  const { colors, spacing: s } = useTheme();
  const run = useEvalRun(runId);
  const queue = useEvalReviewQueue({ run_id: runId });
  const submit = useSubmitReview();
  const cancel = useCancelRun();
  const remove = useDeleteRun();
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([run.refetch(), queue.refetch()]));

  if (run.isPending) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Sweep' }} />
        <LoadingState text="Loading sweep" />
      </Screen>
    );
  }
  if (run.isError || !run.data) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Sweep' }} />
        <ErrorState message={messageOf(run.error, 'Could not load this sweep.')} onRetry={() => void run.refetch()} />
      </Screen>
    );
  }

  const data = run.data;
  const live = isLiveRun(data.status);
  const provisional = data.status === 'awaiting_review' || data.passed === null;
  const canDelete = !live && !(data.status === 'cancelled' && !data.completed_at);
  const results: EvalResult[] = data.results;
  const queued = queue.data ?? [];

  const verdict = (resultId: number, v: Verdict) => {
    submit.mutate({ resultId, verdict: v }, { onSuccess: () => success() });
  };

  const stop = () => {
    cancel.mutate(runId, { onSuccess: () => warning() });
  };

  const removeRun = async () => {
    const ok = await confirm({
      title: 'Delete this sweep?',
      message: 'Its results and evaluation traces are removed. This cannot be undone.',
      destructiveLabel: 'Delete',
    });
    if (!ok) return;
    warning();
    remove.mutate(runId, { onSuccess: () => router.back() });
  };

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: data.suite_name || 'Sweep' }} />
      <ScrollView
        contentContainerStyle={{ gap: s.lg, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={{ gap: s.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: s.sm }}>
            <RunStatusPill status={data.status} />
            <ScoreText run={data} />
          </View>
          <Text style={[typography.caption, { color: colors.mutedText }]}>
            {data.agent_name || 'agent'}
            {data.revision_number !== null ? ` · rev ${data.revision_number}` : ''}
            {` · ${data.total_cases} ${data.total_cases === 1 ? 'case' : 'cases'}`}
            {data.grader_agreement !== null ? ` · ${Math.round(data.grader_agreement * 100)}% agreement with the graders` : ''}
          </Text>
          {provisional ? (
            <Text style={[typography.caption, { color: colors.warning }]}>
              Provisional. {data.pending_review_count > 0 ? `${data.pending_review_count} result${data.pending_review_count === 1 ? '' : 's'} still wait for a reviewer. ` : ''}
              This score can still move until every queued result is answered.
            </Text>
          ) : null}
          {data.error_message ? <Text style={[typography.caption, { color: colors.danger }]}>{data.error_message}</Text> : null}
        </View>

        {live ? (
          <Button title="Stop sweep" variant="secondary" onPress={stop} loading={cancel.isPending} />
        ) : null}

        {queued.length > 0 ? (
          <>
            <GroupHeader title="Waiting on you" footer="Your verdict overrides the grader without erasing it." />
            <View style={{ gap: s.md }}>
              {queued.map((item) => (
                <ReviewItem
                  key={item.id}
                  item={item}
                  busy={submit.isPending && submit.variables?.resultId === item.id}
                  onVerdict={(v) => verdict(item.id, v)}
                />
              ))}
            </View>
          </>
        ) : null}

        <GroupHeader title="Results" />
        <ErrorText message={submit.isError ? messageOf(submit.error, 'Could not save that verdict.') : null} />
        {results.length === 0 ? (
          <Text style={[typography.caption, { color: colors.mutedText }]}>No results recorded yet.</Text>
        ) : (
          <View style={{ gap: s.sm }}>
            {results.map((r) => (
              <ResultRow key={r.id} result={r} />
            ))}
          </View>
        )}

        {canDelete ? (
          <Button title="Delete sweep" variant="secondary" onPress={() => void removeRun()} loading={remove.isPending} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** One result: its answer or error, what it asked and changed, and its final verdict. */
function ResultRow({ result: r }: { result: EvalResult }) {
  const { colors, spacing: s } = useTheme();
  const verdictText =
    r.final_passed === null ? 'Awaiting review' : r.final_passed ? 'Pass' : 'Fail';
  const verdictColor =
    r.final_passed === null ? colors.warning : r.final_passed ? colors.success : colors.danger;
  return (
    <Card>
      <View style={{ gap: s.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: s.sm }}>
          <Text style={[typography.label, { flex: 1, color: colors.text }]}>{r.case_name || `Case ${r.case ?? r.id}`}</Text>
          <View style={{ alignItems: 'flex-end' }}>
            {r.review && r.auto_passed !== r.final_passed ? (
              <Text style={[typography.caption, { color: colors.mutedText }]}>
                Grader: {r.auto_passed ? 'pass' : 'fail'}
              </Text>
            ) : null}
            <Text style={[typography.caption, { color: verdictColor, fontWeight: '600' }]}>{verdictText}</Text>
          </View>
        </View>
        {r.error_message ? (
          <Text style={[typography.caption, { color: colors.danger }]}>{r.error_message}</Text>
        ) : (
          <Text style={[typography.caption, { color: colors.mutedText }]} numberOfLines={6}>
            {r.answer || '(no answer)'}
          </Text>
        )}
        <IntentList intents={r.intents} />
        <ChangedList changes={r.env_changes} />
      </View>
    </Card>
  );
}
