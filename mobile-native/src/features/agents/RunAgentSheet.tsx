import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { ErrorText } from '../../components/ErrorText';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { useTheme } from '../../theme';
import { messageOf } from './format';
import { useStartRun } from './queries';

interface Props {
  agentId: number;
  agentName: string;
  /** The agent's standing instructions. A run with no typed task uses them as its goal. */
  brief: string;
  onClose: () => void;
  /** Called with the new run's id once the server has accepted it. */
  onStarted: (executionId: string) => void;
}

/**
 * Starts one run by hand. Mounted only while open, so each opening starts with
 * an empty task. A refusal (spend cap, missing key, paused agent) comes back
 * before any run exists and is shown here. It is not retried.
 */
export function RunAgentSheet({ agentId, agentName, brief, onClose, onStarted }: Props) {
  const { colors, spacing, fontSize, radius } = useTheme();
  const [task, setTask] = useState('');
  const start = useStartRun(agentId);

  // Same rule as the web dialog: a typed task wins, otherwise the brief runs.
  const goal = task.trim() || brief.trim();
  const canRun = goal.length > 0 && !start.isPending;

  const run = () => {
    if (!canRun) return;
    start.mutate(goal, {
      onSuccess: (started) => onStarted(started.execution_id),
    });
  };

  const hint = task.trim()
    ? 'This task is the goal for the run.'
    : brief.trim()
      ? "Leave it empty to run on the agent's brief."
      : 'This agent has no brief, so type a task to run it.';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.backdrop, { backgroundColor: colors.scrim }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={StyleSheet.absoluteFill}
          onPress={start.isPending ? undefined : onClose}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              padding: spacing.lg,
              gap: spacing.md,
            },
          ]}
        >
          <Text style={{ color: colors.text, fontSize: fontSize.xl, fontWeight: '600' }}>
            Run {agentName}
          </Text>
          <TextField
            label="Task (optional)"
            value={task}
            onChangeText={setTask}
            placeholder="What should it do this time?"
            placeholderTextColor={colors.mutedText}
            multiline
            editable={!start.isPending}
            style={{ minHeight: 96, textAlignVertical: 'top' }}
          />
          <Text style={{ color: colors.mutedText, fontSize: fontSize.sm }}>{hint}</Text>
          <ErrorText
            message={start.isError ? messageOf(start.error, 'The run could not be started.') : null}
          />
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={styles.half}>
              <Button title="Cancel" variant="secondary" onPress={onClose} disabled={start.isPending} />
            </View>
            <View style={styles.half}>
              <Button title="Run" onPress={run} loading={start.isPending} disabled={!canRun} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { width: '100%' },
  half: { flex: 1 },
});
