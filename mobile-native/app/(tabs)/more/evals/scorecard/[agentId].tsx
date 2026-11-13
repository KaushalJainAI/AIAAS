import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import { Card } from '../../../../../src/components/Card';
import { EmptyState } from '../../../../../src/components/EmptyState';
import { ErrorState } from '../../../../../src/components/ErrorState';
import { LoadingState } from '../../../../../src/components/LoadingState';
import { Screen } from '../../../../../src/components/Screen';
import { Text } from '../../../../../src/components/Text';
import { messageOf } from '../../../../../src/features/agents/format';
import { RunStatusPill, ScoreText } from '../../../../../src/features/evals/Parts';
import { useScorecard } from '../../../../../src/features/evals/queries';
import type { ScorecardPoint, ScorecardSuite } from '../../../../../src/features/evals/types';
import { useRefresh } from '../../../../../src/hooks/useRefresh';
import { spacing, typography, useTheme } from '../../../../../src/theme';

/**
 * How one agent scores across every suite pointed at it. The latest score is the last
 * settled sweep. A sweep still awaiting review is counted, never shown as the score.
 */
export default function ScorecardScreen() {
  const { agentId: raw = '' } = useLocalSearchParams<{ agentId: string }>();
  const agentId = Number(raw);
  const { colors, spacing: s } = useTheme();
  const card = useScorecard(agentId);
  const { refreshing, onRefresh } = useRefresh(() => card.refetch());

  if (!Number.isFinite(agentId)) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Scorecard' }} />
        <ErrorState title="Agent not found" message="This agent may have been deleted." />
      </Screen>
    );
  }
  if (card.isPending) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Scorecard' }} />
        <LoadingState text="Loading scorecard" />
      </Screen>
    );
  }
  if (card.isError || !card.data) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Scorecard' }} />
        <ErrorState message={messageOf(card.error, 'Could not load this scorecard.')} onRetry={() => void card.refetch()} />
      </Screen>
    );
  }

  const data = card.data;
  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: data.agent_name ? `${data.agent_name} scorecard` : 'Scorecard' }} />
      <ScrollView
        contentContainerStyle={{ gap: s.md, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {data.suites.length === 0 ? (
          <EmptyState title="No sweeps on this agent yet" message="Run a suite against it and its scores appear here." />
        ) : (
          data.suites.map((suite) => <SuiteScore key={suite.suite_id} suite={suite} />)
        )}
      </ScrollView>
    </Screen>
  );
}

function SuiteScore({ suite }: { suite: ScorecardSuite }) {
  const { colors, spacing: s } = useTheme();
  const latest = suite.latest;
  return (
    <Card>
      <View style={{ gap: s.sm }}>
        <Text style={[typography.label, { color: colors.text }]}>{suite.suite_name}</Text>
        {latest ? <LatestLine point={latest} /> : (
          <Text style={[typography.caption, { color: colors.mutedText }]}>No settled sweep yet.</Text>
        )}
        {suite.awaiting_review > 0 ? (
          <Text style={[typography.caption, { color: colors.warning }]}>
            {suite.awaiting_review} more sweep{suite.awaiting_review === 1 ? '' : 's'} awaiting review. Not counted as the latest score.
          </Text>
        ) : null}
        {suite.history.length > 0 ? (
          <View style={{ gap: s.xs }}>
            <Text style={[typography.caption, { color: colors.text }]}>Recent sweeps</Text>
            {suite.history.map((p) => (
              <HistoryLine key={p.run_id} point={p} />
            ))}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

function LatestLine({ point }: { point: ScorecardPoint }) {
  const { colors, spacing: s } = useTheme();
  return (
    <View style={{ gap: s.xs }}>
      <ScoreText run={{ score: point.score, passed: point.passed, status: point.status, pending_review_count: 0 }} />
      <Text style={[typography.caption, { color: colors.mutedText }]}>
        {point.revision !== null ? `Revision ${point.revision}` : 'No revision'}
        {point.grader_agreement !== null ? ` · ${Math.round(point.grader_agreement * 100)}% agreement` : ''}
      </Text>
    </View>
  );
}

function HistoryLine({ point }: { point: ScorecardPoint }) {
  const { colors, spacing: s } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: s.sm }}>
      <Text style={[typography.caption, { color: colors.mutedText, flex: 1 }]}>
        {new Date(point.created_at).toLocaleDateString()}
        {point.revision !== null ? ` · rev ${point.revision}` : ''}
      </Text>
      <RunStatusPill status={point.status} />
      <ScoreText run={{ score: point.score, passed: point.passed, status: point.status, pending_review_count: 0 }} />
    </View>
  );
}
