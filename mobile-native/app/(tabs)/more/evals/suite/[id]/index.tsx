import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Button } from '../../../../../../src/components/Button';
import { Card } from '../../../../../../src/components/Card';
import { ErrorState } from '../../../../../../src/components/ErrorState';
import { ErrorText } from '../../../../../../src/components/ErrorText';
import { ListRow } from '../../../../../../src/components/ListRow';
import { LoadingState } from '../../../../../../src/components/LoadingState';
import { Screen } from '../../../../../../src/components/Screen';
import { Section } from '../../../../../../src/components/Section';
import { Text } from '../../../../../../src/components/Text';
import { confirm } from '../../../../../../src/components/confirm';
import { messageOf } from '../../../../../../src/features/agents/format';
import { useAgents } from '../../../../../../src/features/agents/queries';
import { ChoicePicker } from '../../../../../../src/features/explore/ChoicePicker';
import { GroupHeader } from '../../../../../../src/features/explore/GroupHeader';
import { CATEGORY_LABELS, caseCategory, casesWord } from '../../../../../../src/features/evals/format';
import { DraftsPanel } from '../../../../../../src/features/evals/DraftsPanel';
import { ScoreText } from '../../../../../../src/features/evals/Parts';
import { WorldPanel } from '../../../../../../src/features/evals/WorldPanel';
import { useDeleteSuite, useEvalSuite, useRunSuite, useSuiteWorld, useUpdateSuite } from '../../../../../../src/features/evals/queries';
import { DRAFT_TAG, isDraft, type EvalCase, type GatedCalls } from '../../../../../../src/features/evals/types';
import { useRefresh } from '../../../../../../src/hooks/useRefresh';
import { success, warning } from '../../../../../../src/lib/haptics';
import { spacing, typography, useTheme } from '../../../../../../src/theme';

const GATED_OPTIONS: { value: GatedCalls; label: string; hint: string }[] = [
  { value: 'run', label: 'Record and run', hint: 'The call happens. It is recorded on the result.' },
  { value: 'block', label: 'Record and block', hint: 'The call is declined. Benchmark guardrail suites use this.' },
];

/** One suite: how it runs, its test world, its drafts (accepted here only), and its cases. */
export default function SuiteDetailScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const suiteId = Number(id);
  const router = useRouter();
  const { colors, spacing: s } = useTheme();
  const suite = useEvalSuite(suiteId);
  const agents = useAgents();
  const world = useSuiteWorld(suiteId);
  const run = useRunSuite();
  const update = useUpdateSuite();
  const remove = useDeleteSuite();
  const [agentId, setAgentId] = useState<number | null>(null);
  const [picking, setPicking] = useState<'agent' | 'gated' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { refreshing, onRefresh } = useRefresh(() => Promise.all([suite.refetch(), world.refetch()]));

  if (!Number.isFinite(suiteId)) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Suite' }} />
        <ErrorState title="Suite not found" message="This suite may have been deleted." />
      </Screen>
    );
  }
  if (suite.isPending) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Suite' }} />
        <LoadingState text="Loading suite" />
      </Screen>
    );
  }
  if (suite.isError || !suite.data) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Suite' }} />
        <ErrorState message={messageOf(suite.error, 'Could not load this suite.')} onRetry={() => void suite.refetch()} />
      </Screen>
    );
  }

  const data = suite.data;
  const agentList = (agents.data ?? []).filter((a) => a.status !== 'archived');
  const chosen = agentId ?? data.subagent;
  const agentName = agentList.find((a) => a.id === chosen)?.name ?? 'Choose an agent';
  const drafts = data.cases.filter(isDraft);
  const cases = data.cases.filter((c) => !isDraft(c));
  const liveVersion = world.data?.live?.version ?? null;
  const canRun = cases.length > 0 && chosen != null && !run.isPending;

  const startRun = async () => {
    if (chosen == null) return;
    const capNote =
      data.max_cost_rupees != null ? ` Spend stops at ₹${data.max_cost_rupees} for this sweep.` : '';
    const ok = await confirm({
      title: `Run ${casesWord(cases.length)}?`,
      message: `Each case is one agent run against ${agentName}, billed to that agent's model. Judge checks are billed to your key.${capNote} Results are provisional until any queued for review are answered.`,
      destructiveLabel: 'Run',
    });
    if (!ok) return;
    setError(null);
    run.mutate(
      { suiteId, body: { agent_id: chosen } },
      {
        onSuccess: (res) => {
          success();
          router.push(`/more/evals/run/${res.run_id}`);
        },
        onError: (err) => setError(messageOf(err, 'Could not start the sweep.')),
      },
    );
  };

  const setGated = (value: GatedCalls) => {
    setError(null);
    update.mutate(
      { id: suiteId, body: { gated_calls: value } },
      { onError: (err) => setError(messageOf(err, 'Could not save that setting.')) },
    );
  };

  const removeSuite = async () => {
    const ok = await confirm({
      title: `Delete ${data.name}?`,
      message: 'The suite, its cases and its sweep history are removed. This cannot be undone.',
      destructiveLabel: 'Delete',
    });
    if (!ok) return;
    warning();
    remove.mutate(suiteId, { onSuccess: () => router.back(), onError: (err) => setError(messageOf(err, 'Could not delete the suite.')) });
  };

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: data.name }} />
      <ScrollView
        contentContainerStyle={{ gap: s.lg, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={{ gap: s.xs }}>
          {data.description ? <Text style={[typography.body, { color: colors.mutedText }]}>{data.description}</Text> : null}
          <Text style={[typography.caption, { color: colors.mutedText }]}>
            {casesWord(cases.length)} · pass at {Math.round(data.pass_threshold * 100)}% · review: {data.supervision}
          </Text>
          {data.last_run ? (
            <ScoreText run={{ ...data.last_run, pending_review_count: data.last_run.pending_review }} />
          ) : null}
        </View>

        <GroupHeader title="Run" />
        <Card>
          <View style={{ gap: s.sm }}>
            <Button title={`Agent: ${agentName}`} variant="secondary" onPress={() => setPicking('agent')} />
            <Button
              title={`Calls needing approval: ${GATED_OPTIONS.find((o) => o.value === data.gated_calls)?.label ?? 'Record and run'}`}
              variant="secondary"
              onPress={() => setPicking('gated')}
            />
            <Button
              title={run.isPending ? 'Starting' : 'Run suite'}
              onPress={() => void startRun()}
              disabled={!canRun}
              loading={run.isPending}
            />
            {cases.length === 0 ? (
              <Text style={[typography.caption, { color: colors.mutedText }]}>This suite has no cases yet.</Text>
            ) : null}
            {chosen == null ? (
              <Text style={[typography.caption, { color: colors.mutedText }]}>Pick an agent first.</Text>
            ) : null}
          </View>
        </Card>
        <ErrorText message={error} />

        <GroupHeader title="Test world" footer="A world lets the cases test what the agent does, not only what it says." />
        <WorldPanel suiteId={suiteId} hasAgent={chosen != null} />

        <GroupHeader title="Drafts" footer={`Drafts are not scored until accepted. Accepting happens here only. Drafts tagged ${DRAFT_TAG} come from generation or imports.`} />
        <DraftsPanel suiteId={suiteId} hasAgent={chosen != null} drafts={drafts} />

        <GroupHeader title="Cases" />
        <Button title="Write a case" variant="secondary" onPress={() => router.push(`/more/evals/case/new?suiteId=${suiteId}`)} />
        {cases.length === 0 ? (
          <Text style={[typography.caption, { color: colors.mutedText }]}>
            No cases yet. Generate some from the agent’s setup, import its recent runs, or write your own.
          </Text>
        ) : (
          <Section>
            {cases.map((c) => (
              <CaseRow
                key={c.id}
                item={c}
                liveVersion={liveVersion}
                onPress={() => router.push(`/more/evals/case/${c.id}?suiteId=${suiteId}`)}
              />
            ))}
          </Section>
        )}

        <GroupHeader title="Suite" />
        <View style={{ gap: s.sm }}>
          <Button title="Edit suite" variant="secondary" onPress={() => router.push(`/more/evals/suite/${suiteId}/edit`)} />
          <Button title="Delete suite" variant="secondary" onPress={() => void removeSuite()} loading={remove.isPending} />
        </View>
      </ScrollView>

      <ChoicePicker<number>
        visible={picking === 'agent'}
        title="Agent"
        value={chosen}
        options={agentList.map((a) => ({ value: a.id, label: a.name }))}
        onSelect={setAgentId}
        onClose={() => setPicking(null)}
      />
      <ChoicePicker<GatedCalls>
        visible={picking === 'gated'}
        title="Calls needing approval"
        value={data.gated_calls}
        options={GATED_OPTIONS}
        onSelect={setGated}
        onClose={() => setPicking(null)}
      />
    </Screen>
  );
}

/** One accepted case: its goal on the row, the rest one tap away in the case screen. */
function CaseRow({ item, liveVersion, onPress }: { item: EvalCase; liveVersion: number | null; onPress: () => void }) {
  const stale = item.world_version !== null && liveVersion !== null && item.world_version !== liveVersion;
  const category = caseCategory(item);
  const label = category === 'normal' ? '' : `${CATEGORY_LABELS[category] ?? category} · `;
  const worldNote =
    item.world_version != null ? (stale ? ` · stale (world v${item.world_version})` : ` · world v${item.world_version}`) : '';
  return (
    <ListRow
      title={item.name || `Case ${item.id}`}
      subtitle={`${label}${item.goal}${worldNote}${item.is_active ? '' : ' · inactive'}`}
      detail={`${item.graders.length} ${item.graders.length === 1 ? 'check' : 'checks'}`}
      onPress={onPress}
    />
  );
}

