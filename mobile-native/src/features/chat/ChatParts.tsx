/**
 * The pieces of a conversation: bubbles, the live turn, and the approval and
 * question cards. Wording follows the web chat (`ToolApprovalCard`, `QuestionCard`).
 */
import { type ReactNode, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { ErrorText } from '../../components/ErrorText';
import { Icon } from '../../components/Icon';
import { Markdown } from '../../components/Markdown';
import { Text } from '../../components/Text';
import { fontFamily } from '../../fonts';
import { radius, spacing, typography, useTheme } from '../../theme';
import { AgentRunCard, AnswerExtras, BlockedNotice } from './AnswerExtras';
import { CommandCard } from './CommandCard';
import { PlanList } from './PlanList';
import type { TurnState } from './useChatTurn';
import type { ChatMessage, PendingApproval, PendingQuestion } from './types';

export { PlanList } from './PlanList';

/** A message the person wrote, right-aligned. `attached` lists files sent with it. */
export function UserBubble({ text, attached = [] }: { text: string; attached?: string[] }) {
  const { colors, spacing: s, radius: r } = useTheme();
  return (
    <View style={styles.userRow}>
      <View style={{ maxWidth: '85%', gap: s.xs, alignItems: 'flex-end' }}>
        {attached.length > 0 ? (
          <Text selectable style={[typography.caption, { color: colors.mutedText }]}>
            {attached.join(', ')}
          </Text>
        ) : null}
        {text ? (
          <View style={{ backgroundColor: colors.primary, borderRadius: r.md, padding: s.md }}>
            <Text selectable style={[typography.body, { color: colors.primaryText }]}>
              {text}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Reasoning, collapsed by default. Its heading says whether it is still being written. */
export function ThinkingBlock({ text, live }: { text: string; live: boolean }) {
  const { colors, spacing: s } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: s.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        hitSlop={8}
        style={styles.thinkingHead}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-forward'} size={14} color={colors.mutedText} />
        <Text style={[typography.caption, { color: colors.mutedText, fontWeight: '600' }]}>
          {live ? 'Thinking…' : 'Thought process'}
        </Text>
      </Pressable>
      {open ? (
        <Text selectable style={[typography.caption, { color: colors.mutedText }]}>
          {text}
        </Text>
      ) : null}
    </View>
  );
}

/** The assistant's answer: reasoning, text, then everything the turn produced. */
function AnswerBody({
  content,
  thinking,
  extras,
  onReviewSolution,
}: {
  content: string;
  thinking: string;
  extras: Parameters<typeof AnswerExtras>[0];
  onReviewSolution?: Parameters<typeof AnswerExtras>[0]['onReviewSolution'];
}) {
  const { spacing: s } = useTheme();
  return (
    <View style={{ gap: s.sm }}>
      {thinking ? <ThinkingBlock text={thinking} live={false} /> : null}
      {content ? <Markdown text={content} /> : null}
      <AnswerExtras {...extras} onReviewSolution={onReviewSolution} />
    </View>
  );
}

/** One saved message: the person's text, or the assistant's answer with everything it carried. */
export function MessageBubble({
  message,
  onLongPress,
  onReviewSolution,
}: {
  message: ChatMessage;
  onLongPress?: (message: ChatMessage) => void;
  onReviewSolution?: Parameters<typeof AnswerExtras>[0]['onReviewSolution'];
}) {
  const { spacing: s } = useTheme();
  const meta = message.metadata ?? {};
  const pressable = Boolean(onLongPress);
  const wrap = (node: ReactNode) =>
    pressable ? (
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Long press for message actions"
        onLongPress={() => onLongPress?.(message)}
        delayLongPress={350}
      >
        {node}
      </Pressable>
    ) : (
      node
    );

  if (message.role === 'user') {
    const attached = Array.isArray(meta.attachments) ? (meta.attachments as string[]) : [];
    return wrap(<UserBubble text={message.content} attached={attached} />);
  }

  const thinking = typeof meta.thinking === 'string' ? meta.thinking : '';
  const todos = Array.isArray(meta.todos) ? meta.todos : [];
  const extras = {
    sources: Array.isArray(meta.sources) ? meta.sources : [],
    images: Array.isArray(meta.images) ? meta.images : [],
    files: Array.isArray(meta.files) ? meta.files : [],
    charts: Array.isArray(meta.charts) ? meta.charts : [],
    htmlArtifacts: Array.isArray(meta.html_artifacts) ? meta.html_artifacts : [],
    workerPlans: Object.entries(meta.worker_plans ?? {}).map(([execution_id, w]) => ({
      execution_id,
      agent_name: w.agent_name || 'Agent',
      todos: w.todos ?? [],
    })),
    solutions: Array.isArray(meta.solutions_used) ? meta.solutions_used : [],
  };
  return wrap(
    <View style={{ gap: s.sm }}>
      <AnswerBody content={message.content} thinking={thinking} extras={extras} onReviewSolution={onReviewSolution} />
      <PlanList todos={todos} />
      {meta.agent_run?.execution_id ? (
        <AgentRunCard
          run={{
            agent_name: meta.agent_run.agent_name || 'Agent',
            execution_id: meta.agent_run.execution_id,
            status: meta.agent_run.status || 'running',
          }}
        />
      ) : null}
    </View>,
  );
}

export function ApprovalCard({
  approval,
  onApprove,
  onDeny,
}: {
  approval: PendingApproval;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const { colors, spacing: s, radius: r } = useTheme();
  const warnings: string[] = [];
  if (approval.leavesWorkspace) warnings.push('This sends something outside your workspace.');
  if (approval.firstContact) warnings.push('First time this agent writes to them.');
  if (approval.effect === 'irreversible') warnings.push('This cannot be undone.');

  return (
    <View
      accessibilityLabel="Waiting for your approval"
      style={[styles.card, { borderColor: colors.warning, backgroundColor: colors.surface, borderRadius: r.md, overflow: 'hidden' }]}
    >
      <View style={[styles.cardHead, { backgroundColor: colors.warningBg, borderBottomColor: colors.border }]}>
        <Text style={[typography.label, { color: colors.warning }]}>Waiting for you</Text>
      </View>
      <View style={{ padding: s.md, gap: s.sm }}>
        <View style={{ gap: s.xs }}>
          <Text style={[typography.label, { color: colors.text }]}>{approval.title}</Text>
          <Text selectable style={[typography.body, { color: colors.mutedText }]}>
            {`${approval.sentence} Nothing has happened yet.`}
          </Text>
        </View>
        {approval.fields.map((field, i) => (
          <View key={`${i}-${field.label}`} style={styles.field}>
            <Text style={[typography.body, { color: colors.mutedText, width: 88 }]}>{field.label}</Text>
            <Text selectable style={[typography.body, { color: colors.text, flex: 1 }]}>
              {field.value}
            </Text>
          </View>
        ))}
        {warnings.map((w) => (
          <Text key={w} style={[typography.caption, { color: colors.danger }]}>
            {w}
          </Text>
        ))}
      </View>
      <View style={[styles.actions, { borderTopColor: colors.border, padding: s.md }]}>
        <View style={{ flex: 1 }}>
          <Button title={approval.actionLabel} onPress={onApprove} />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Decline" onPress={onDeny} style={styles.textAction}>
          <Text style={[typography.label, { color: colors.mutedText }]}>Decline</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function QuestionCard({
  question,
  onAnswer,
  onSkip,
}: {
  question: PendingQuestion;
  onAnswer: (value: string | number | string[]) => void;
  onSkip: () => void;
}) {
  const { colors, spacing: s, radius: r } = useTheme();
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const isChoice = question.kind === 'choice' || question.kind === 'multi_choice';
  const multi = question.kind === 'multi_choice';
  const showsInput = question.kind === 'number' || question.kind === 'text' || question.allowOther;

  const submit = () => {
    if (question.kind === 'number') {
      const value = Number(text);
      if (!text.trim() || !Number.isFinite(value)) return setProblem('Enter a number.');
      if (question.min != null && value < question.min) return setProblem(`The number must be at least ${question.min}.`);
      if (question.max != null && value > question.max) return setProblem(`The number must be at most ${question.max}.`);
      return onAnswer(value);
    }
    if (multi) {
      const all = [...picked, ...(question.allowOther && text.trim() ? [text.trim()] : [])];
      if (all.length === 0) return setProblem('Pick at least one option.');
      return onAnswer(all);
    }
    const typed = question.kind === 'choice' ? (picked[0] ?? text).trim() : text.trim();
    if (!typed) return setProblem(question.kind === 'choice' ? 'Pick one option.' : 'Write an answer.');
    return onAnswer(typed);
  };

  const tapOption = (option: string) => {
    if (multi) {
      setPicked((prev) => (prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option]));
      return;
    }
    // A single choice with nothing else to type answers on the tap.
    if (!question.allowOther) return onAnswer(option);
    setPicked([option]);
  };

  return (
    <View
      accessibilityLabel={question.question}
      style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface, borderRadius: r.md, padding: s.md, gap: s.sm }]}
    >
      <Text style={[typography.caption, { color: colors.mutedText, fontWeight: '600' }]}>waiting for you</Text>
      <Text selectable style={[typography.label, { color: colors.text }]}>
        {question.question}
      </Text>
      {multi ? <Text style={[typography.caption, { color: colors.mutedText }]}>Pick all that apply.</Text> : null}

      {isChoice ? (
        <View style={{ gap: s.sm }}>
          {question.options.map((option) => {
            const on = picked.includes(option);
            return (
              <Pressable
                key={option}
                accessibilityRole={multi ? 'checkbox' : 'radio'}
                accessibilityState={{ selected: on, checked: on }}
                onPress={() => tapOption(option)}
                style={[
                  styles.option,
                  { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.surface : colors.background, borderRadius: r.md },
                ]}
              >
                <Icon name={on ? 'radio-button-on' : 'radio-button-off'} size={18} color={on ? colors.primary : colors.mutedText} />
                <Text style={[typography.body, { color: colors.text, flex: 1 }]}>{option}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {showsInput ? (
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v);
            setProblem(null);
          }}
          placeholder={question.kind === 'number' ? question.unit || 'Number' : question.allowOther ? 'Other answer' : 'Your answer'}
          placeholderTextColor={colors.mutedText}
          keyboardType={question.kind === 'number' ? 'decimal-pad' : 'default'}
          multiline={question.kind === 'text'}
          accessibilityLabel="Your answer"
          style={[
            styles.input,
            {
              color: colors.text,
              backgroundColor: colors.inputBackground,
              borderColor: problem ? colors.danger : colors.border,
              borderRadius: r.md,
              fontFamily: fontFamily.regular,
            },
          ]}
        />
      ) : null}

      <ErrorText message={problem} />

      <View style={{ flexDirection: 'row', gap: s.sm }}>
        {!isChoice || question.allowOther || multi ? (
          <View style={{ flex: 1 }}>
            <Button title="Send" onPress={submit} />
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skip"
          onPress={onSkip}
          style={[styles.skip, { borderColor: colors.border, borderRadius: r.md }]}
        >
          <Icon name="play-skip-forward-outline" size={16} color={colors.mutedText} />
          <Text style={[typography.label, { color: colors.mutedText }]}>Skip</Text>
        </Pressable>
      </View>
      {question.assumption ? (
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          {'If you skip, it will go ahead assuming: '}
          <Text style={[typography.caption, { color: colors.text }]}>{question.assumption}</Text>
        </Text>
      ) : null}
    </View>
  );
}

/** The turn in progress: status, reasoning, the answer as it streams, extras, cards and errors. */
export function LiveTurn({
  state,
  onApprove,
  onReject,
  onSkip,
  onAnswer,
  onDismissBlocked,
  onReviewSolution,
  onConfirmCommand,
  onCancelCommand,
}: {
  state: TurnState;
  onApprove: (callId: string) => void;
  onReject: (callId: string) => void;
  onSkip: (callId: string) => void;
  onAnswer: (callId: string, value: string | number | string[]) => void;
  onDismissBlocked: () => void;
  onReviewSolution: (id: number, kind: 'confirmed' | 'failed') => Promise<void>;
  onConfirmCommand: (values: Record<string, unknown>) => void;
  onCancelCommand: () => void;
}) {
  const { colors, spacing: s } = useTheme();
  const { approval, question } = state;
  const waiting = approval !== null || question !== null;
  const idle = !state.content && !state.thinking && !waiting && !state.error;

  return (
    <View style={{ gap: s.sm }}>
      {state.active && idle ? (
        <View style={styles.working}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[typography.body, { color: colors.mutedText }]}>{state.status ?? 'Working…'}</Text>
        </View>
      ) : null}
      {state.thinking ? <ThinkingBlock text={state.thinking} live={state.active} /> : null}
      {state.content ? <Markdown text={state.content} /> : null}
      {state.active && state.status && !idle ? (
        <Text style={[typography.caption, { color: colors.mutedText }]}>{state.status}</Text>
      ) : null}
      <AnswerExtras
        sources={state.sources}
        images={state.images}
        files={state.files}
        charts={state.charts}
        htmlArtifacts={state.htmlArtifacts}
        workerPlans={state.workerPlans}
        solutions={state.solutions}
        onReviewSolution={onReviewSolution}
      />
      <PlanList todos={state.todos} />
      {state.agentRun ? <AgentRunCard run={state.agentRun} /> : null}
      {state.commandCard ? (
        <CommandCard card={state.commandCard} onConfirm={onConfirmCommand} onCancel={onCancelCommand} />
      ) : null}
      {state.blocked ? (
        <BlockedNotice message={state.blocked.message} items={state.blocked.items} onDismiss={onDismissBlocked} />
      ) : null}
      {approval ? (
        <ApprovalCard
          approval={approval}
          onApprove={() => onApprove(approval.callId)}
          onDeny={() => onReject(approval.callId)}
        />
      ) : null}
      {question ? (
        <QuestionCard
          question={question}
          onAnswer={(value) => onAnswer(question.callId, value)}
          onSkip={() => onSkip(question.callId)}
        />
      ) : null}
      {state.error ? (
        <View style={[styles.errorBox, { borderColor: colors.danger, borderRadius: radius.md }]}>
          <Text accessibilityRole="alert" style={[typography.body, { color: colors.danger }]}>
            {state.error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  userRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  thinkingHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44 },
  card: { borderWidth: StyleSheet.hairlineWidth },
  cardHead: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  field: { flexDirection: 'row', gap: spacing.sm },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  textAction: { minHeight: 44, paddingHorizontal: spacing.md, justifyContent: 'center' },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.md, minHeight: 44 },
  input: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  skip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: StyleSheet.hairlineWidth, minHeight: 44, paddingHorizontal: spacing.md },
  working: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  errorBox: { borderWidth: StyleSheet.hairlineWidth, padding: spacing.md },
});
