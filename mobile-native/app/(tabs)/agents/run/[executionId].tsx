import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { confirm } from '../../../../src/components/confirm';
import { useIsFocused, useLocalSearchParams } from 'expo-router';

import { Button } from '../../../../src/components/Button';
import { ErrorText } from '../../../../src/components/ErrorText';
import { Screen } from '../../../../src/components/Screen';
import { Text } from '../../../../src/components/Text';
import { TextField } from '../../../../src/components/TextField';
import {
  DECISION_LABEL,
  TODO_LABEL,
  elapsedMs,
  finalAnswer,
  formatCost,
  formatDuration,
  formatWhen,
  messageOf,
  planOf,
} from '../../../../src/features/agents/format';
import { useCancelRun, useRun, useSteerRun } from '../../../../src/features/agents/queries';
import { StatusPill } from '../../../../src/features/agents/StatusPill';
import type { AgentStep, AgentTurn } from '../../../../src/features/agents/types';
import { useTheme } from '../../../../src/theme';

export default function RunScreen() {
  const { executionId: raw } = useLocalSearchParams<{ executionId: string }>();
  const executionId = String(raw ?? '');
  const { colors, spacing, fontSize, radius } = useTheme();

  // Polling only while this screen is in front: a run on a background tab is
  // not re-read every three seconds.
  const focused = useIsFocused();
  const run = useRun(executionId, focused);
  const cancel = useCancelRun(executionId);
  const steer = useSteerRun(executionId);
  const [steerText, setSteerText] = useState('');
  const [steerNote, setSteerNote] = useState<string | null>(null);

  const d = run.data;
  const running = d?.status === 'running';
  const notStarted = d?.status === 'pending';

  const onSteer = () => {
    const message = steerText.trim();
    if (!message || steer.isPending) return;
    steer.mutate(message, {
      onSuccess: (result) => {
        setSteerText('');
        setSteerNote(
          result.dropped > 0
            ? `Sent. ${result.queued} waiting. ${result.dropped} older instruction(s) were dropped because the queue was full.`
            : `Sent. ${result.queued} waiting to be read.`,
        );
      },
    });
  };

  const onCancel = async () => {
    const ok = await confirm({
      title: 'Stop this run?',
      message: 'Stopping cannot be undone.',
      destructiveLabel: 'Stop run',
      cancelLabel: 'Keep running',
    });
    if (ok) cancel.mutate();
  };

  if (run.isPending) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (run.isError || !d) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <ErrorText message={messageOf(run.error, 'That run could not be loaded.')} />
        <View style={{ marginTop: spacing.md }}>
          <Button title="Try again" variant="secondary" onPress={() => void run.refetch()} />
        </View>
      </Screen>
    );
  }

  const answer = finalAnswer(d);
  const plan = planOf(d.output_data);
  const turns: AgentTurn[] = d.turns ?? [];
  const withSteps = turns.filter((t) => t.steps.length > 0);
  const lastAnswer = [...turns].reverse().find((t) => t.decision === 'answer');
  const heading = { color: colors.text, fontSize: fontSize.lg, fontWeight: '600' } as const;
  const muted = { color: colors.mutedText, fontSize: fontSize.sm } as const;
  const card = [
    styles.card,
    { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  ];

  const duration =
    d.status === 'running' || d.status === 'pending'
      ? formatDuration(elapsedMs(d.started_at, d.created_at))
      : formatDuration(d.duration_ms);

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ScrollView
        contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xl }}
        refreshControl={
          <RefreshControl refreshing={run.isRefetching} onRefresh={() => void run.refetch()} tintColor={colors.primary} />
        }
      >
        <View style={card}>
          <View style={styles.row}>
            <StatusPill status={d.status} />
            <Text style={{ color: colors.mutedText, fontSize: fontSize.sm, flex: 1, textAlign: 'right' }}>
              {d.workflow_name ?? 'Deleted agent'}
            </Text>
          </View>
          <View style={styles.fact}>
            <Text style={muted}>Started</Text>
            <Text style={{ color: colors.text, fontSize: fontSize.md }}>{formatWhen(d.started_at ?? d.created_at)}</Text>
          </View>
          <View style={styles.fact}>
            <Text style={muted}>Duration</Text>
            <Text style={{ color: colors.text, fontSize: fontSize.md }}>{duration}</Text>
          </View>
          <View style={styles.fact}>
            <Text style={muted}>Cost</Text>
            <Text style={{ color: colors.text, fontSize: fontSize.md }}>{formatCost(d.cost_usd, d.cost_source)}</Text>
          </View>
        </View>

        {d.error_message ? (
          <View style={[card, { borderColor: colors.danger }]}>
            <Text style={{ color: colors.danger, fontSize: fontSize.md, fontWeight: '600' }}>Error</Text>
            <Text selectable style={{ color: colors.danger, fontSize: fontSize.md }}>{d.error_message}</Text>
          </View>
        ) : null}

        {running ? (
          <View style={{ gap: spacing.md }}>
            <Button title="Stop run" variant="secondary" onPress={onCancel} loading={cancel.isPending} />
            <ErrorText message={cancel.isError ? messageOf(cancel.error, 'This run could not be stopped.') : null} />
            <TextField
              label="Steer this run"
              value={steerText}
              onChangeText={(text) => {
                setSteerText(text);
                setSteerNote(null);
              }}
              placeholder="An instruction for its next step"
              multiline
              style={{ minHeight: 72, textAlignVertical: 'top' }}
              editable={!steer.isPending}
            />
            <ErrorText message={steer.isError ? messageOf(steer.error, 'The instruction was not sent.') : null} />
            {steerNote ? <Text style={muted}>{steerNote}</Text> : null}
            <Button
              title="Send instruction"
              variant="secondary"
              onPress={onSteer}
              loading={steer.isPending}
              disabled={!steerText.trim()}
            />
          </View>
        ) : null}

        {notStarted ? (
          <Text style={muted}>Queued. It starts as soon as the server has room.</Text>
        ) : null}

        {d.status === 'paused' ? (
          <View style={card}>
            <Text style={heading}>Waiting for you</Text>
            <Text style={{ color: colors.mutedText, fontSize: fontSize.md }}>
              This run asked for an approval or an answer. Respond to it from the Inbox or on the web app.
            </Text>
          </View>
        ) : null}

        <View style={card}>
          <Text style={heading}>Answer</Text>
          {answer ? (
            <>
              <Text selectable style={{ color: colors.text, fontSize: fontSize.md, lineHeight: 22 }}>{answer}</Text>
              {lastAnswer?.content_truncated ? (
                <Text style={muted}>The answer was trimmed on the server. The full text is on the web app.</Text>
              ) : null}
            </>
          ) : (
            <Text style={muted}>
              {running || notStarted ? 'Still working.' : d.status === 'paused' ? 'Not answered yet.' : 'No answer was recorded.'}
            </Text>
          )}
        </View>

        {plan.length > 0 ? (
          <View style={card}>
            <Text style={heading}>Plan</Text>
            {plan.map((item, i) => (
              <View key={`${i}-${item.text}`} style={styles.todo}>
                <Text style={[muted, { width: 64 }]}>{TODO_LABEL[item.status] ?? item.status}</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text selectable style={{ color: colors.text, fontSize: fontSize.md }}>{item.text}</Text>
                  {item.note ? <Text style={muted}>{item.note}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        <View style={{ gap: spacing.md }}>
          <Text style={heading}>Steps</Text>
          {withSteps.length === 0 && (d.unattributed_steps ?? []).length === 0 ? (
            <Text style={muted}>No tool calls yet.</Text>
          ) : null}
          {withSteps.map((turn) => (
            <View key={turn.index} style={card}>
              <Text style={muted}>
                {`Turn ${turn.index} · ${DECISION_LABEL[turn.decision] ?? turn.decision}`}
              </Text>
              {turn.steps.map((step) => (
                <StepRow key={step.id} step={step} />
              ))}
            </View>
          ))}
          {(d.unattributed_steps ?? []).length > 0 ? (
            <View style={card}>
              <Text style={muted}>Other tool calls</Text>
              {d.unattributed_steps.map((step) => (
                <StepRow key={step.id} step={step} />
              ))}
            </View>
          ) : null}
          {d.turns_truncated || d.steps_truncated ? (
            <Text style={muted}>
              Showing part of this run. The full trace is on the web app.
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

/** One tool call: its name, how it ended, and the error if it failed. */
function StepRow({ step }: { step: AgentStep }) {
  const { colors, fontSize, spacing } = useTheme();
  const tone =
    step.status === 'failed'
      ? colors.danger
      : step.status === 'completed'
        ? colors.text
        : colors.mutedText;
  const word =
    step.status === 'completed'
      ? 'done'
      : step.status === 'failed'
        ? 'failed'
        : step.status === 'running'
          ? 'running'
          : step.status === 'skipped'
            ? 'skipped'
            : 'waiting';
  return (
    <View style={{ gap: 2, paddingVertical: spacing.xs }}>
      <View style={styles.row}>
        <Text selectable style={{ color: colors.text, fontSize: fontSize.md, flex: 1 }}>{step.tool}</Text>
        <Text style={{ color: tone, fontSize: fontSize.sm }}>{word}</Text>
      </View>
      {step.error_message ? (
        <Text selectable style={{ color: colors.danger, fontSize: fontSize.sm }}>{step.error_message}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: { borderWidth: StyleSheet.hairlineWidth },
  fact: { gap: 2 },
  todo: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
});
