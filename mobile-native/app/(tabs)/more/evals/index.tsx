import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { Button } from '../../../../src/components/Button';
import { EmptyState } from '../../../../src/components/EmptyState';
import { ErrorState } from '../../../../src/components/ErrorState';
import { ErrorText } from '../../../../src/components/ErrorText';
import { ListRow } from '../../../../src/components/ListRow';
import { LoadingState } from '../../../../src/components/LoadingState';
import { Screen } from '../../../../src/components/Screen';
import { SegmentedControl } from '../../../../src/components/SegmentedControl';
import { Section } from '../../../../src/components/Section';
import { Text } from '../../../../src/components/Text';
import { messageOf } from '../../../../src/features/agents/format';
import { useAgents } from '../../../../src/features/agents/queries';
import { ChoicePicker } from '../../../../src/features/explore/ChoicePicker';
import { GroupHeader } from '../../../../src/features/explore/GroupHeader';
import { JudgeCard, ReviewItem, RunStatusPill, ScoreText } from '../../../../src/features/evals/Parts';
import {
  useCloneStarter,
  useEvalReviewQueue,
  useEvalRuns,
  useEvalSuites,
  useJudgeCalibration,
  useStarterKits,
  useSubmitReview,
} from '../../../../src/features/evals/queries';
import type { EvalRun, EvalSuite, QueueItem, Verdict } from '../../../../src/features/evals/types';
import { useRefresh } from '../../../../src/hooks/useRefresh';
import { success } from '../../../../src/lib/haptics';
import { spacing, typography, useTheme } from '../../../../src/theme';

type Tab = 'review' | 'suites' | 'runs';

/** Evals: the review queue first (the only part waiting on a person), then suites and sweep history. */
export default function EvalsScreen() {
  const router = useRouter();
  const { colors, spacing: s } = useTheme();
  const [tab, setTab] = useState<Tab>('review');
  const [error, setError] = useState<string | null>(null);

  const suites = useEvalSuites();
  const runs = useEvalRuns();
  const queue = useEvalReviewQueue();
  const judge = useJudgeCalibration();
  const agents = useAgents();
  const submit = useSubmitReview();

  const suiteList: EvalSuite[] = suites.data?.suites ?? [];
  const runList: EvalRun[] = runs.data ?? [];
  const queueList: QueueItem[] = queue.data ?? [];
  const agentList = (agents.data ?? []).filter((a) => a.status !== 'archived').map((a) => ({ id: a.id, name: a.name }));

  const { refreshing, onRefresh } = useRefresh(() =>
    Promise.all([suites.refetch(), runs.refetch(), queue.refetch(), judge.refetch()]),
  );

  const verdict = (item: QueueItem, v: Verdict) => {
    setError(null);
    submit.mutate(
      { resultId: item.id, verdict: v },
      {
        onSuccess: () => success(),
        onError: (err) => setError(messageOf(err, 'Could not save that verdict.')),
      },
    );
  };

  let body;
  if (tab === 'review') {
    body = queue.isPending ? (
      <LoadingState text="Loading the queue" />
    ) : queue.isError ? (
      <ErrorState message={messageOf(queue.error, 'Could not load the review queue.')} onRetry={() => void queue.refetch()} />
    ) : queueList.length === 0 ? (
      <EmptyState
        title="Nothing waiting on you"
        message="Results land here when a suite's review policy queues them. By default, the ones the graders were least sure about."
      />
    ) : (
      <View style={{ gap: s.md }}>
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          Your verdict overrides the grader without erasing it. The grader’s answer is kept so agreement stays measurable.
        </Text>
        {queueList.map((item) => (
          <ReviewItem
            key={item.id}
            item={item}
            busy={submit.isPending && submit.variables?.resultId === item.id}
            onVerdict={(v) => verdict(item, v)}
          />
        ))}
      </View>
    );
  } else if (tab === 'suites') {
    body = (
      <View style={{ gap: s.lg }}>
        <Button title="New suite" onPress={() => router.push('/more/evals/suite/new')} />
        <StarterKits agents={agentList} onCloned={(id) => router.push(`/more/evals/suite/${id}`)} />

        <GroupHeader title="Suites" footer="A suite is a set of cases (a goal and what a good answer looks like) run against one agent." />
        {suites.isPending ? (
          <LoadingState text="Loading suites" />
        ) : suites.isError ? (
          <ErrorState message={messageOf(suites.error, 'Could not load suites.')} onRetry={() => void suites.refetch()} />
        ) : suiteList.length === 0 ? (
          <EmptyState title="No suites yet" message="Create a suite, or start from a starter dataset above." />
        ) : (
          <Section>
            {suiteList.map((suite) => (
              <ListRow
                key={suite.id}
                title={suite.name}
                subtitle={`${suite.case_count} ${suite.case_count === 1 ? 'case' : 'cases'} · pass at ${Math.round(suite.pass_threshold * 100)}% · review: ${suite.supervision}`}
                detail={
                  suite.last_run ? (
                    <ScoreText run={{ ...suite.last_run, pending_review_count: suite.last_run.pending_review }} />
                  ) : undefined
                }
                onPress={() => router.push(`/more/evals/suite/${suite.id}`)}
              />
            ))}
          </Section>
        )}

        <GroupHeader title="Scorecards" footer="How one agent scores across every suite pointed at it. Only settled sweeps count as its latest score." />
        {agents.isPending ? (
          <LoadingState text="Loading agents" />
        ) : agentList.length === 0 ? (
          <EmptyState title="No agents yet" message="Build an agent first, then its scorecard appears here." />
        ) : (
          <Section>
            {agentList.map((a) => (
              <ListRow
                key={a.id}
                title={a.name}
                subtitle="Open its scorecard"
                onPress={() => router.push(`/more/evals/scorecard/${a.id}`)}
              />
            ))}
          </Section>
        )}
      </View>
    );
  } else {
    body = runs.isPending ? (
      <LoadingState text="Loading sweeps" />
    ) : runs.isError ? (
      <ErrorState message={messageOf(runs.error, 'Could not load sweeps.')} onRetry={() => void runs.refetch()} />
    ) : runList.length === 0 ? (
      <EmptyState title="No sweeps yet" message="Run a suite and its history shows up here." />
    ) : (
      <Section>
        {runList.map((run) => (
          <ListRow
            key={run.run_id}
            title={run.suite_name || 'Suite'}
            subtitle={[
              run.agent_name || 'agent',
              run.revision_number !== null ? `rev ${run.revision_number}` : '',
              `${run.total_cases} ${run.total_cases === 1 ? 'case' : 'cases'}`,
              new Date(run.created_at).toLocaleString(),
            ]
              .filter(Boolean)
              .join(' · ')}
            detail={
              <View style={styles.runDetail}>
                <RunStatusPill status={run.status} />
                <ScoreText run={run} />
              </View>
            }
            onPress={() => router.push(`/more/evals/run/${run.run_id}`)}
          />
        ))}
      </Section>
    );
  }

  const counts: Record<Tab, number> = { review: queueList.length, suites: suiteList.length, runs: runList.length };

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: 'Evals' }} />
      <ScrollView
        contentContainerStyle={{ gap: s.lg, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          Does this agent still do what it did last week, and do you agree with the grader?
        </Text>
        <JudgeCard data={judge.data} />
        <SegmentedControl
          items={[
            { key: 'review', label: 'Review', count: counts.review },
            { key: 'suites', label: 'Suites', count: counts.suites },
            { key: 'runs', label: 'Runs', count: counts.runs },
          ]}
          value={tab}
          onChange={setTab}
        />
        <ErrorText message={error} />
        {body}
      </ScrollView>
    </Screen>
  );
}

/** Starter datasets: core checks plus real-world tasks, cloned into a suite of your own. */
function StarterKits({ agents, onCloned }: { agents: { id: number; name: string }[]; onCloned: (suiteId: number) => void }) {
  const { colors, spacing: s } = useTheme();
  const [agentId, setAgentId] = useState<string>('');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kits = useStarterKits(agentId ? Number(agentId) : undefined);
  const clone = useCloneStarter();
  const list = kits.data?.kits ?? [];
  const recommended = new Set(kits.data?.recommended ?? []);
  const agentLabel = agents.find((a) => String(a.id) === agentId)?.name ?? 'No agent (generic)';

  if (kits.isPending || list.length === 0) return null;

  return (
    <View style={{ gap: s.sm }}>
      <GroupHeader title="Start from a starter dataset" footer="Core checks plus real-world tasks: normal, ambiguous, impossible, guardrail, hallucination trap." />
      <Button title={`For: ${agentLabel}`} variant="secondary" onPress={() => setPicking(true)} />
      <ErrorText message={error} />
      <Section>
        {list.map((k) => (
          <ListRow
            key={k.slug}
            title={recommended.has(k.slug) ? `${k.name} · Recommended` : k.name}
            subtitle={`${k.description} · ${k.case_count} cases`}
            detail={
              <Button
                title={clone.isPending && clone.variables?.template === k.slug ? 'Cloning' : 'Clone'}
                variant="secondary"
                disabled={clone.isPending}
                loading={clone.isPending && clone.variables?.template === k.slug}
                onPress={() => {
                  setError(null);
                  clone.mutate(
                    { template: k.slug, ...(agentId ? { agent_id: Number(agentId) } : {}) },
                    {
                      onSuccess: (suite) => {
                        success();
                        onCloned(suite.id);
                      },
                      onError: (err) => setError(messageOf(err, 'Could not clone the starter.')),
                    },
                  );
                }}
              />
            }
            chevron={false}
          />
        ))}
      </Section>
      <ChoicePicker<string>
        visible={picking}
        title="Agent for the starter"
        value={agentId}
        options={[{ value: '', label: 'No agent (generic)' }, ...agents.map((a) => ({ value: String(a.id), label: a.name }))]}
        onSelect={setAgentId}
        onClose={() => setPicking(false)}
      />
      <Text style={[typography.caption, { color: colors.mutedText }]}>
        Cloning copies the cases into a suite you own. Review the suite before running it.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  runDetail: { alignItems: 'flex-end', gap: spacing.xs },
});

