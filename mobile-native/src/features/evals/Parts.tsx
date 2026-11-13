import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { toneColors, type Tone } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { Markdown } from '../../components/Markdown';
import { Text } from '../../components/Text';
import { radius, spacing, typography, useTheme } from '../../theme';
import { RUN_STATUS_LABEL, changedLines, scoreText } from './format';
import type { EvalIntent, JudgeCalibration, QueueItem, RunStatus, Verdict } from './types';

const STATUS_TONE: Record<string, Tone> = {
  completed: 'success',
  awaiting_review: 'warning',
  running: 'info',
  failed: 'danger',
};

/** A run's status in plain words. "Awaiting review" is a state, not a failure. */
export function RunStatusPill({ status }: { status: RunStatus | string }) {
  const { colors } = useTheme();
  const { fg, bg } = toneColors(STATUS_TONE[status] ?? 'neutral', colors);
  return (
    <View accessibilityRole="text" accessibilityLabel={RUN_STATUS_LABEL[status] ?? status} style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[typography.caption, { color: fg, fontWeight: '600' }]}>{RUN_STATUS_LABEL[status] ?? status}</Text>
    </View>
  );
}

/** A score, marked provisional while a person still has to answer for it. */
export function ScoreText({ run }: { run: Parameters<typeof scoreText>[0] }) {
  const { colors } = useTheme();
  const s = scoreText(run);
  const color = s.provisional ? colors.warning : s.passed === false ? colors.danger : s.passed === true ? colors.success : colors.mutedText;
  return (
    <Text accessibilityRole="text" style={[typography.caption, { color, fontWeight: '600' }]}>
      {s.text}
    </Text>
  );
}

/** The judge that grades the cases, and how often it agreed with people. */
export function JudgeCard({ data }: { data?: JudgeCalibration | null }) {
  const { colors, spacing: s } = useTheme();
  const calib = data?.calibrations?.handwritten ?? data?.calibrations?.gold;
  if (!calib) return null;
  return (
    <Card>
      <View style={{ gap: s.xs }}>
        <Text style={[typography.label, { color: colors.text }]}>Judge calibration</Text>
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          Judge <Text style={[typography.mono, { color: colors.text }]}>{calib.judge_model}</Text>
          {' · '}agreement {Math.round(calib.agreement * 100)}%
          {' · '}false-pass {Math.round(calib.false_pass_rate * 100)}%
          {' · '}{new Date(calib.created_at).toLocaleDateString()}
        </Text>
      </View>
    </Card>
  );
}

/** What an eval run wanted from a person: questions it would have asked, approvals it would have needed. */
export function IntentList({ intents }: { intents?: EvalIntent[] }) {
  const { colors, spacing: s } = useTheme();
  if (!intents?.length) return null;
  return (
    <View style={{ gap: s.xs, marginTop: s.xs }}>
      {intents.map((intent, i) => (
        <View key={intent.call_id || i} style={styles.line}>
          <Icon
            name={intent.kind === 'question' ? 'help-circle-outline' : 'shield-half-outline'}
            size={14}
            color={intent.kind === 'question' ? colors.primary : colors.warning}
          />
          <Text style={[typography.caption, styles.lineText, { color: colors.mutedText }]}>
            {intent.kind === 'question' ? (
              <>
                <Text style={[typography.caption, { color: colors.text }]}>Asked: </Text>
                {intent.question}
                {intent.assumption ? ` (assumed ${intent.assumption})` : ''}
              </>
            ) : (
              <>
                <Text style={[typography.caption, { color: colors.text }]}>Would ask approval: </Text>
                {intent.sentence || intent.tool}
              </>
            )}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** The world changes a result made, in short lines. */
export function ChangedList({ changes }: { changes?: Record<string, unknown> }) {
  const { colors } = useTheme();
  const lines = changedLines(changes);
  if (lines.length === 0) return null;
  return (
    <Text style={[typography.caption, { color: colors.mutedText, marginTop: spacing.xs }]}>
      <Text style={[typography.caption, { color: colors.text }]}>Changed: </Text>
      {lines.join(' · ')}
    </Text>
  );
}

/**
 * One result waiting for a person. The grader's answer is shown beside the verdict,
 * because the verdict overrides it without erasing it: agreement needs both.
 */
export function ReviewItem({
  item,
  busy,
  onVerdict,
}: {
  item: QueueItem;
  busy: boolean;
  onVerdict: (verdict: Verdict) => void;
}) {
  const { colors, spacing: s } = useTheme();
  const router = useRouter();
  const noAnswer = item.status === 'error' || item.status === 'skipped';
  const grader =
    item.auto_passed === null ? 'no opinion' : item.auto_passed ? 'pass' : 'fail';

  return (
    <Card>
      <View style={{ gap: s.sm }}>
        <View style={styles.head}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[typography.label, { color: colors.text }]}>{item.case_name || 'Untitled case'}</Text>
            <Text style={[typography.caption, { color: colors.mutedText }]}>
              {item.suite_name}
              {item.review_reason ? ` · queued because: ${item.review_reason}` : ''}
            </Text>
          </View>
          <View style={[styles.chip, { backgroundColor: noAnswer ? colors.dangerBg : colors.border }]}>
            <Text style={[typography.caption, { color: noAnswer ? colors.danger : colors.mutedText }]}>
              {noAnswer ? 'no answer' : `grader: ${grader}`}
            </Text>
          </View>
        </View>

        {item.goal ? (
          <Text style={[typography.caption, { color: colors.mutedText }]}>
            <Text style={[typography.caption, { color: colors.text }]}>Goal: </Text>
            {item.goal}
          </Text>
        ) : null}

        {noAnswer ? (
          <Text style={[typography.body, { color: colors.danger }]}>
            {item.error_message || 'The agent did not produce an answer.'}
          </Text>
        ) : (
          <View style={{ gap: s.xs }}>
            <Text style={[typography.caption, { color: colors.text }]}>Answer</Text>
            <Markdown text={item.answer || '(empty)'} />
            {item.answer_truncated ? <Text style={[typography.caption, { color: colors.mutedText }]}>(truncated)</Text> : null}
          </View>
        )}

        {noAnswer ? (
          <Text style={[typography.caption, { color: colors.mutedText }]}>
            Dismiss this result to remove it from the queue. It cannot be scored as a human verdict.
          </Text>
        ) : null}

        <View style={styles.verdicts}>
          {noAnswer ? (
            <Button title="Dismiss result" variant="secondary" onPress={() => onVerdict('unsure')} disabled={busy} />
          ) : (
            <>
              <Button title="Pass" onPress={() => onVerdict('pass')} disabled={busy} />
              <Button title="Fail" variant="secondary" onPress={() => onVerdict('fail')} disabled={busy} />
              <Button title="Unsure" variant="secondary" onPress={() => onVerdict('unsure')} disabled={busy} />
            </>
          )}
        </View>

        {item.execution_id ? (
          <Button
            title="Full trace"
            variant="secondary"
            onPress={() => router.push(`/agents/run/${item.execution_id}`)}
          />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  lineText: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  chip: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  verdicts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
