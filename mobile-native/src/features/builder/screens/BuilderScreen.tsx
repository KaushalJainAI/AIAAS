/**
 * The frame every builder screen sits in: the header title and Save action, the
 * server's refusal at the top, and loading and error states. A screen supplies
 * only its own fields, as a component of its own, so its hooks run only once the
 * agent has loaded.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView } from 'react-native';
import { Stack, router } from 'expo-router';

import { ErrorState } from '../../../components/ErrorState';
import { LoadingState } from '../../../components/LoadingState';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { messageOf } from '../../agents/format';
import { pressedOpacity, spacing, typography, useTheme } from '../../../theme';
import type { AgentConfig } from '../types';
import { Notice } from '../ui';
import { useBuilder } from '../useBuilder';

export type Builder = ReturnType<typeof useBuilder>;

interface Props {
  id: string;
  title: string;
  /** Called once the board is loaded, with the config the screen edits. */
  render: (builder: Builder, cfg: AgentConfig) => ReactNode;
}

/** Save, in the header. Greyed when there is nothing to save. */
function SaveAction({ onPress, disabled, busy }: { onPress: () => void; disabled: boolean; busy: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Save"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: spacing.sm,
        opacity: disabled ? 0.4 : pressed ? pressedOpacity : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <Text style={[typography.label, { color: colors.primary }]}>Save</Text>
      )}
    </Pressable>
  );
}

/** Save the whole board, then leave a create flow for the new agent's page. */
export function saveBoard(builder: Builder): () => Promise<void> {
  return async () => {
    const result = await builder.save();
    if (result.ok && builder.isNew) {
      router.replace(`/agents/${result.agent.id}`);
    }
  };
}

export function BuilderScreen({ id, title, render }: Props) {
  const builder = useBuilder(id);
  const save = saveBoard(builder);
  const { spacing: s, colors } = useTheme();

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <SaveAction
              onPress={() => void save()}
              disabled={builder.saving || (!builder.isNew && !builder.dirty)}
              busy={builder.saving}
            />
          ),
        }}
      />
      {!builder.isNew && builder.savedError && !builder.saved ? (
        <ErrorState message={messageOf(builder.savedError, 'Could not load this agent.')} />
      ) : null}
      {!builder.savedError && !builder.cfg ? <LoadingState text="Loading the agent" /> : null}
      {builder.cfg ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: s.lg, paddingBottom: s.xxl, backgroundColor: colors.background }}
        >
          {builder.summary ? <Notice text={builder.summary} /> : null}
          {render(builder, builder.cfg)}
        </ScrollView>
      ) : null}
    </Screen>
  );
}
