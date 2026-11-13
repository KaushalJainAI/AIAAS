import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorState } from '../../components/ErrorState';
import { ErrorText } from '../../components/ErrorText';
import { Icon } from '../../components/Icon';
import { LoadingState } from '../../components/LoadingState';
import { Markdown } from '../../components/Markdown';
import { Screen } from '../../components/Screen';
import { Sheet } from '../../components/Sheet';
import { StatusPill } from '../../components/StatusPill';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { confirm } from '../../components/confirm';
import { useRefresh } from '../../hooks/useRefresh';
import { useIsLive } from '../../hooks/usePolling';
import { DECISION_LABEL, TODO_LABEL, finalAnswer, formatDuration, formatWhen, messageOf, planOf, elapsedMs } from '../agents/format';
import { evalsApi } from '../evals/api';
import { success, warning } from '../../lib/haptics';
import { pressedOpacity, radius, spacing, typography, useTheme } from '../../theme';
import { Chip, ChipRow } from './Chips';
import { AUTONOMY_OPTIONS, CALLER_LABEL, costQualifier, formatCostInr, isDeletableRun, isLiveRun, prettyJson, LIVE_ACTION_LABEL } from './format';
import {
  useCancelRun,
  useDeleteRun,
  useLiveActivity,
  useMarkRunFailed,
  useRunDetail,
  useSetRunAutonomy,
  useSteerRun,
  useSubmitFeedback,
} from './queries';
import type { AgentStep, AgentTurn, ExecutionDetail, RunAutonomyLevel } from './types';

const REASONS = ['wrong', 'incomplete', 'slow', 'unsafe', 'ignored_instructions', 'other'];

/** One run in full: its answer, plan, cost, the trace of turns and tool calls, and the controls a live run offers. */
export function RunDetailScreen({ executionId }: { executionId: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const watching = useIsLive();
  const run = useRunDetail(executionId, watching);
  const live = useLiveActivity(watching);
  const cancel = useCancelRun(executionId);
  const steer = useSteerRun(executionId);
  const autonomy = useSetRunAutonomy(executionId);
  const markFailed = useMarkRunFailed(executionId);
  const remove = useDeleteRun();
  const feedback = useSubmitFeedback();
  const saveCase = useMutation({
    mutationFn: () => evalsApi.caseFromRun({ execution_id: executionId }),
    onSuccess: () => success(),
  });
  const { refreshing, onRefresh } = useRefresh(run.refetch);
  const [steerText, setSteerText] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  if (run.isPending) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Run' }} />
        <LoadingState text="Loading run" />
      </Screen>
    );
  }

  if (run.isError || !run.data) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Run' }} />
        <ErrorState message={messageOf(run.error, 'That run could not be loaded.')} onRetry={() => void run.refetch()} />
      </Screen>
    );
  }

  const d = run.data;
  const running = isLiveRun(d.status);
  const liveItem = live.data?.items.find((item) => item.id === d.execution_id);
  const canMarkFailed = liveItem?.actions.includes('mark_failed') ?? false;
  const answer = finalAnswer(d);
  const plan = planOf(d.output_data);

  const onStop = async () => {
    const ok = await confirm({ title: 'Stop this run?', message: 'Stopping cannot be undone.', destructiveLabel: 'Stop' });
    if (!ok) return;
    warning();
    cancel.mutate();
  };

  const onMarkFailed = async () => {
    const ok = await confirm({
      title: 'Mark this run as failed?',
      message: 'This closes it as failed so it stops counting as live.',
      destructiveLabel: 'Mark as failed',
    });
    if (!ok) return;
    warning();
    markFailed.mutate();
  };

  const onDelete = async () => {
    const ok = await confirm({
      title: 'Delete this run?',
      message: "The run and its trace go away. Cost records are kept so spend totals don't drop. This cannot be undone.",
      destructiveLabel: 'Delete',
    });
    if (!ok) return;
    warning();
    remove.mutate(d.execution_id, { onSuccess: () => router.back() });
  };

  const sendSteer = () => {
    const text = steerText.trim();
    if (!text || steer.isPending) return;
    steer.mutate(text, {
      onSuccess: () => {
        success();
        setSteerText('');
      },
    });
  };

  const delegated = d.delegated_by;

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: d.workflow_name ?? 'Run' }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Card style={styles.block}>
          <View style={styles.row}>
            <StatusPill status={d.status} />
            <Text style={[typography.caption, styles.grow, { color: colors.mutedText, textAlign: 'right' }]} numberOfLines={1}>
              {CALLER_LABEL[d.caller] ?? d.trigger_type}
            </Text>
          </View>
          <Fact label="Started" value={formatWhen(d.started_at ?? d.created_at)} />
          <Fact
            label="Duration"
            value={running ? formatDuration(elapsedMs(d.started_at, d.created_at)) : formatDuration(d.duration_ms)}
          />
          <CostBlock detail={d} />
          {d.revision ? (
            <Text style={[typography.caption, { color: colors.mutedText }]}>
              {`Ran on configuration v${d.revision.number}${d.revision.summary ? ` — ${d.revision.summary}` : ''}`}
            </Text>
          ) : null}
        </Card>

        {delegated ? (
          <Card style={styles.block}>
            <Text style={[typography.label, { color: colors.text }]}>
              {`Started by ${delegated.workflow_name ?? 'a deleted agent'}${delegated.turn_index != null ? ` — step ${delegated.turn_index}` : ''}`}
            </Text>
            {delegated.task ? <Text style={[typography.body, { color: colors.text }]}>{`Task: ${delegated.task}`}</Text> : null}
            {delegated.reasoning ? (
              <Text style={[typography.caption, { color: colors.mutedText }]}>{delegated.reasoning}</Text>
            ) : null}
            <Button
              title="Open that run"
              variant="secondary"
              onPress={() => router.push(`/more/runs/${encodeURIComponent(delegated.execution_id)}`)}
            />
          </Card>
        ) : null}

        {d.error_message ? (
          <Card style={{ ...styles.block, borderColor: colors.danger }}>
            <Text style={[typography.label, { color: colors.danger }]}>Error</Text>
            <Text selectable style={[typography.body, { color: colors.danger }]}>{d.error_message}</Text>
          </Card>
        ) : null}

        {running ? (
          <Card style={styles.block}>
            <Text style={[typography.label, { color: colors.text }]}>Controls</Text>
            <View style={styles.row}>
              <Button title="Stop run" variant="secondary" onPress={() => void onStop()} loading={cancel.isPending} />
            </View>
            <ErrorText message={cancel.isError ? messageOf(cancel.error, 'This run could not be stopped.') : null} />
            {d.workflow_id != null && d.status !== 'paused' ? (
              <View style={{ gap: spacing.sm }}>
                <Text style={[typography.caption, { color: colors.mutedText }]}>Approvals for the rest of this run</Text>
                <ChipRow>
                  {AUTONOMY_OPTIONS.map((option) => (
                    <Chip
                      key={option.key}
                      label={option.label}
                      selected={false}
                      accessibilityLabel={`${option.label}: ${option.hint}`}
                      onPress={() => autonomy.mutate(option.key as RunAutonomyLevel)}
                    />
                  ))}
                </ChipRow>
                <ErrorText message={autonomy.isError ? messageOf(autonomy.error, 'That did not change.') : null} />
              </View>
            ) : null}
            {d.workflow_id != null && d.status !== 'paused' ? (
              <View style={{ gap: spacing.sm }}>
                <TextField
                  label="Tell it something mid-run"
                  value={steerText}
                  onChangeText={setSteerText}
                  placeholder="e.g. also check the pricing page"
                  editable={!steer.isPending}
                />
                <ErrorText message={steer.isError ? messageOf(steer.error, 'The instruction was not sent.') : null} />
                <Button title="Send" variant="secondary" onPress={sendSteer} loading={steer.isPending} disabled={!steerText.trim()} />
              </View>
            ) : null}
          </Card>
        ) : null}

        {canMarkFailed ? (
          <Button title={LIVE_ACTION_LABEL.mark_failed} variant="secondary" onPress={() => void onMarkFailed()} loading={markFailed.isPending} />
        ) : null}
        <ErrorText message={markFailed.isError ? messageOf(markFailed.error, 'Could not mark it failed.') : null} />

        {d.status === 'paused' ? (
          <Card style={styles.block}>
            <Text style={[typography.label, { color: colors.warning }]}>Waiting for you</Text>
            <Text style={[typography.body, { color: colors.text }]}>
              This run asked for an approval or an answer. Respond to it from the Inbox.
            </Text>
            <Button title="Open the Inbox" variant="secondary" onPress={() => router.push('/inbox')} />
          </Card>
        ) : null}

        <Card style={styles.block}>
          <Text style={[typography.label, { color: colors.text }]}>Answer</Text>
          {answer ? (
            <Markdown text={answer} />
          ) : (
            <Text style={[typography.body, { color: colors.mutedText }]}>
              {running ? 'Still working.' : d.status === 'paused' ? 'Not answered yet.' : 'No answer was recorded.'}
            </Text>
          )}
        </Card>

        {plan.length > 0 ? (
          <Card style={styles.block}>
            <Text style={[typography.label, { color: colors.text }]}>Plan</Text>
            {plan.map((item, i) => (
              <View key={`${i}-${item.text}`} style={styles.todo}>
                <Text style={[typography.caption, { color: colors.mutedText, width: 72 }]}>
                  {TODO_LABEL[item.status] ?? item.status}
                </Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text selectable style={[typography.body, { color: colors.text }]}>{item.text}</Text>
                  {item.note ? <Text style={[typography.caption, { color: colors.mutedText }]}>{item.note}</Text> : null}
                </View>
              </View>
            ))}
          </Card>
        ) : null}

        <Card style={styles.block}>
          <Text style={[typography.label, { color: colors.text }]}>Feedback</Text>
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Good answer"
              accessibilityState={{ selected: d.feedback?.rating === 1 }}
              onPress={() => feedback.mutate({ target: 'execution', id: d.execution_id, rating: 1 })}
              style={({ pressed }) => [styles.iconButton, { opacity: pressed ? pressedOpacity : 1 }]}
            >
              <Icon name={d.feedback?.rating === 1 ? 'thumbs-up' : 'thumbs-up-outline'} size={22} color={d.feedback?.rating === 1 ? colors.success : colors.mutedText} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Bad answer"
              accessibilityState={{ selected: d.feedback?.rating === -1 }}
              onPress={() => setFeedbackOpen(true)}
              style={({ pressed }) => [styles.iconButton, { opacity: pressed ? pressedOpacity : 1 }]}
            >
              <Icon name={d.feedback?.rating === -1 ? 'thumbs-down' : 'thumbs-down-outline'} size={22} color={d.feedback?.rating === -1 ? colors.danger : colors.mutedText} />
            </Pressable>
          </View>
          <ErrorText message={feedback.isError ? 'Could not save feedback.' : null} />
          <Button
            title="Save as eval case"
            variant="secondary"
            onPress={() => saveCase.mutate()}
            loading={saveCase.isPending}
          />
          {saveCase.isSuccess ? (
            <Text style={[typography.caption, { color: colors.success }]}>
              {`Saved as eval case #${saveCase.data.id}. Review it in Evals.`}
            </Text>
          ) : null}
          <ErrorText message={saveCase.isError ? messageOf(saveCase.error, 'Could not save this run as a case.') : null} />
        </Card>

        <View style={{ gap: spacing.sm }}>
          <Text accessibilityRole="header" style={[typography.label, { color: colors.text, marginTop: spacing.sm }]}>
            Steps
          </Text>
          {d.turns.length === 0 && d.unattributed_steps.length === 0 ? (
            <Text style={[typography.body, { color: colors.mutedText }]}>No steps recorded for this run.</Text>
          ) : null}
          <TraceList detail={d} />
          {d.turns_truncated || d.steps_truncated ? (
            <Text style={[typography.caption, { color: colors.mutedText }]}>
              {`Showing part of this run (${d.turns.length} of ${d.turn_total} steps). The full trace is on the web app.`}
            </Text>
          ) : null}
        </View>

        {isDeletableRun(d) ? (
          <Button title="Delete run" variant="secondary" onPress={() => void onDelete()} loading={remove.isPending} />
        ) : d.caller === 'eval' ? (
          <Text style={[typography.caption, { color: colors.mutedText }]}>
            Evaluation runs are deleted with their sweep on the Evals page.
          </Text>
        ) : null}
        <ErrorText message={remove.isError ? messageOf(remove.error, 'That run could not be deleted.') : null} />
      </ScrollView>

      <Sheet visible={feedbackOpen} onClose={() => setFeedbackOpen(false)} title="What was wrong?">
        {feedbackOpen ? (
          <FeedbackForm
            executionId={d.execution_id}
            initialReason={d.feedback?.reason}
            initialComment={d.feedback?.comment}
            busy={feedback.isPending}
            onSave={(reason, comment) =>
              feedback.mutate(
                { target: 'execution', id: d.execution_id, rating: -1, reason, comment },
                {
                  onSuccess: () => {
                    success();
                    setFeedbackOpen(false);
                  },
                },
              )
            }
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}

function FeedbackForm({
  initialReason,
  initialComment,
  busy,
  onSave,
}: {
  executionId: string;
  initialReason?: string;
  initialComment?: string;
  busy: boolean;
  onSave: (reason: string, comment: string) => void;
}) {
  const [reason, setReason] = useState(initialReason || 'wrong');
  const [comment, setComment] = useState(initialComment ?? '');
  return (
    <View style={{ gap: spacing.md, paddingBottom: spacing.sm }}>
      <ChipRow>
        {REASONS.map((r) => (
          <Chip key={r} label={r.replace(/_/g, ' ')} selected={reason === r} onPress={() => setReason(r)} />
        ))}
      </ChipRow>
      <TextField
        label="Comment (optional)"
        value={comment}
        onChangeText={setComment}
        maxLength={2000}
        multiline
        style={{ minHeight: 72, textAlignVertical: 'top' }}
      />
      <Button title="Save" onPress={() => onSave(reason, comment.trim())} loading={busy} />
    </View>
  );
}

function CostBlock({ detail }: { detail: ExecutionDetail }) {
  const { colors } = useTheme();
  const unpriced = detail.cost_source === 'unpriced';
  const qualifier = costQualifier(detail.cost_source);
  return (
    <View style={{ gap: 2 }}>
      <Fact
        label="Cost"
        value={unpriced ? 'Unknown — no price on record for this model' : `${formatCostInr(detail.cost_usd, detail.cost_source)}${qualifier ? ` ${qualifier}` : ''}`}
      />
      {!unpriced ? (
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          {`${detail.input_tokens.toLocaleString()} in${detail.cached_read_tokens > 0 ? ` (${detail.cached_read_tokens.toLocaleString()} cached)` : ''} · ${detail.output_tokens.toLocaleString()} out`}
        </Text>
      ) : null}
      {detail.delegated_run_count > 0 ? (
        <Fact
          label={`With ${detail.delegated_run_count} delegated`}
          value={formatCostInr(detail.cost_usd_total, detail.cost_source_total)}
        />
      ) : null}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.fact}>
      <Text style={[typography.caption, { color: colors.mutedText }]}>{label}</Text>
      <Text style={[typography.body, { color: colors.text, flexShrink: 1, textAlign: 'right' }]}>{value}</Text>
    </View>
  );
}

/** The turns, newest last, each collapsed to one line until opened. */
function TraceList({ detail }: { detail: ExecutionDetail }) {
  const { colors } = useTheme();
  const slowest = useMemo(() => {
    const all = [...detail.turns.flatMap((t) => t.steps), ...detail.unattributed_steps];
    return Math.max(1, ...all.map((s) => s.duration_ms ?? 0));
  }, [detail]);
  return (
    <View style={{ gap: spacing.sm }}>
      {detail.turns.map((turn) => (
        <TurnCard key={turn.index} turn={turn} slowest={slowest} />
      ))}
      {detail.unattributed_steps.length > 0 ? (
        <Card style={{ gap: spacing.xs }}>
          <Text style={[typography.caption, { color: colors.mutedText }]}>Other tool calls</Text>
          {detail.unattributed_steps.map((step) => (
            <StepRow key={step.id} step={step} slowest={slowest} />
          ))}
        </Card>
      ) : null}
    </View>
  );
}

function TurnCard({ turn, slowest }: { turn: AgentTurn; slowest: number }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const stepCount = turn.steps.length;
  return (
    <Card padded={false}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Step ${turn.index}, ${DECISION_LABEL[turn.decision] ?? turn.decision}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [styles.turnHead, { opacity: pressed ? pressedOpacity : 1 }]}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[typography.label, { color: colors.text }]}>
            {`Step ${turn.index} · ${DECISION_LABEL[turn.decision] ?? turn.decision}`}
          </Text>
          <Text style={[typography.caption, { color: colors.mutedText }]} numberOfLines={1}>
            {`${stepCount} tool call${stepCount === 1 ? '' : 's'} · ${turn.tokens.toLocaleString()} tokens · ${formatCostInr(turn.cost_usd, turn.cost_source)} · ${formatDuration(turn.duration_ms)}`}
          </Text>
        </View>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedText} />
      </Pressable>
      {open ? (
        <View style={styles.turnBody}>
          {turn.reasoning ? (
            <View style={{ gap: 2 }}>
              <Text style={[typography.caption, { color: colors.mutedText }]}>Reasoning</Text>
              <Text selectable style={[typography.caption, { color: colors.mutedText }]}>{turn.reasoning}</Text>
              {turn.reasoning_truncated ? <Text style={[typography.caption, { color: colors.mutedText }]}>…trimmed</Text> : null}
            </View>
          ) : (
            <Text style={[typography.caption, { color: colors.mutedText }]}>This model does not expose its reasoning.</Text>
          )}
          {turn.steps.map((step) => (
            <StepRow key={step.id} step={step} slowest={slowest} />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/** One tool call. Its arguments and result stay closed until opened. */
function StepRow({ step, slowest }: { step: AgentStep; slowest: number }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const failed = step.status === 'failed';
  const args = prettyJson(step.args);
  const result = prettyJson(step.result);
  const ratio = Math.max(0.02, (step.duration_ms ?? 0) / slowest);
  return (
    <View style={styles.step}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${step.tool}, ${step.status}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [styles.stepHead, { opacity: pressed ? pressedOpacity : 1 }]}
      >
        <Icon name={failed ? 'close-circle' : step.status === 'completed' ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={failed ? colors.danger : step.status === 'completed' ? colors.success : colors.mutedText} />
        <Text style={[typography.body, styles.grow, { color: colors.text }]} numberOfLines={1}>{step.tool}</Text>
        <Text style={[typography.caption, { color: colors.mutedText }]}>{formatDuration(step.duration_ms)}</Text>
      </Pressable>
      <View style={[styles.timing, { backgroundColor: colors.border }]}>
        <View style={{ width: `${Math.round(ratio * 100)}%`, height: 3, backgroundColor: failed ? colors.danger : colors.primary }} />
      </View>
      {step.error_message ? <Text selectable style={[typography.caption, { color: colors.danger }]}>{step.error_message}</Text> : null}
      {step.delegated_runs.length > 0 ? <DelegatedList step={step} /> : null}
      {open ? (
        <View style={{ gap: spacing.sm }}>
          {args ? <CodeBlock label="Arguments" text={args} /> : null}
          {result ? <CodeBlock label="Result" text={result} /> : null}
          {!args && !result ? <Text style={[typography.caption, { color: colors.mutedText }]}>No arguments or result recorded.</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function DelegatedList({ step }: { step: AgentStep }) {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <View style={styles.delegated}>
      {step.delegated_runs.map((child) => (
        <Pressable
          key={child.execution_id}
          accessibilityRole="button"
          accessibilityLabel={`Run by ${child.workflow_name ?? 'a deleted agent'}`}
          onPress={() => router.push(`/more/runs/${encodeURIComponent(child.execution_id)}`)}
          style={({ pressed }) => [styles.delegatedRow, { opacity: pressed ? pressedOpacity : 1 }]}
        >
          <Icon name="return-down-forward-outline" size={16} color={colors.mutedText} />
          <Text style={[typography.caption, styles.grow, { color: colors.text }]} numberOfLines={1}>
            {`${child.workflow_name ?? 'Deleted agent'} — ${child.task}`}
          </Text>
          <StatusPill status={child.status} />
        </Pressable>
      ))}
    </View>
  );
}

function CodeBlock({ label, text }: { label: string; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Text style={[typography.caption, { color: colors.mutedText }]}>{label}</Text>
      <View style={[styles.code, { backgroundColor: colors.codeBackground, borderRadius: radius.md }]}>
        <Text selectable style={[typography.mono, { color: colors.text }]}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  block: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  fact: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  todo: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  turnHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, minHeight: 56 },
  turnBody: { padding: spacing.md, paddingTop: 0, gap: spacing.md },
  step: { gap: spacing.xs, paddingVertical: spacing.xs },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  timing: { height: 3, borderRadius: 2, overflow: 'hidden' },
  delegated: { gap: spacing.xs, paddingLeft: spacing.lg },
  delegatedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  code: { padding: spacing.md },
});

