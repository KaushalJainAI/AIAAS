import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { Button } from '../../../../src/components/Button';
import { EmptyState } from '../../../../src/components/EmptyState';
import { ErrorText } from '../../../../src/components/ErrorText';
import { Screen } from '../../../../src/components/Screen';
import { Text } from '../../../../src/components/Text';
import {
  AGENT_STATUS_LABEL,
  AUTONOMY_LABEL,
  formatDuration,
  formatRelative,
  messageOf,
} from '../../../../src/features/agents/format';
import { RunAgentSheet } from '../../../../src/features/agents/RunAgentSheet';
import { useAgent, useAgentRuns } from '../../../../src/features/agents/queries';
import { StatusPill } from '../../../../src/features/agents/StatusPill';
import type { ExecutionLog } from '../../../../src/features/agents/types';
import { fontSize, radius, spacing, typography, useTheme } from '../../../../src/theme';

export default function AgentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const agentId = Number(id);
  const router = useRouter();
  const { colors } = useTheme();
  const agent = useAgent(agentId);
  const runs = useAgentRuns(agentId);
  const [runOpen, setRunOpen] = useState(false);

  // Re-read the run list each time this screen comes back into view, so a run
  // finished in the meantime shows its real status.
  const refetchRuns = runs.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetchRuns();
    }, [refetchRuns]),
  );

  if (!Number.isFinite(agentId)) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <EmptyState title="Agent not found" />
      </Screen>
    );
  }

  if (agent.isPending) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (agent.isError || !agent.data) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <ErrorText message={messageOf(agent.error, 'Could not load this agent.')} />
        <View style={{ marginTop: spacing.md }}>
          <Button title="Try again" variant="secondary" onPress={() => void agent.refetch()} />
        </View>
      </Screen>
    );
  }

  const a = agent.data;
  const schedule = a.schedule?.trim() ?? '';
  const tags = a.tags ?? [];
  const label = { color: colors.mutedText, fontSize: fontSize.sm } as const;
  const value = { color: colors.text, fontSize: fontSize.md } as const;

  const openRun = (executionId: string) => {
    router.push(`/agents/run/${encodeURIComponent(executionId)}`);
  };

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: a.name || 'Agent' }} />
      <ScrollView
        contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xl }}
        refreshControl={
          <RefreshControl
            refreshing={agent.isRefetching || runs.isRefetching}
            onRefresh={() => {
              void agent.refetch();
              void runs.refetch();
            }}
            tintColor={colors.primary}
          />
        }
      >
        <View style={{ gap: spacing.sm }}>
          <Text selectable style={[typography.title, { color: colors.text }]}>
            {a.name}
          </Text>
          {a.description ? (
            <Text selectable style={[typography.body, { color: colors.mutedText }]}>
              {a.description}
            </Text>
          ) : null}
          {tags.length > 0 ? (
            <View style={styles.row}>
              {tags.map((tag) => (
                <View
                  key={tag}
                  style={[styles.tag, { borderColor: colors.border, borderRadius: radius.sm }]}
                >
                  <Text style={[typography.caption, { color: colors.mutedText }]}>{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {a.model_status === 'retired' ? (
          <ErrorText message="This agent's model has been retired. Pick another model in Edit before running it." />
        ) : null}

        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
          ]}
        >
          <View style={styles.fact}>
            <Text style={label}>Status</Text>
            <Text style={value}>{AGENT_STATUS_LABEL[a.status] ?? a.status}</Text>
          </View>
          <View style={styles.fact}>
            <Text style={label}>Model</Text>
            <Text selectable style={value}>{`${a.provider} · ${a.model}`}</Text>
          </View>
          <View style={styles.fact}>
            <Text style={label}>Autonomy</Text>
            <Text style={value}>{AUTONOMY_LABEL[a.autonomy] ?? a.autonomy}</Text>
          </View>
          <View style={styles.fact}>
            <Text style={label}>Schedule</Text>
            <Text selectable style={value}>
              {schedule
                ? `${schedule} (${a.scheduleTimezone})${a.extraSchedules ? ` and ${a.extraSchedules} more` : ''}`
                : 'None. Runs when you ask it to.'}
            </Text>
          </View>
        </View>

        <Button title="Run agent" onPress={() => setRunOpen(true)} />
        <Button title="Edit" variant="secondary" onPress={() => router.push(`/agents/${a.id}/edit` as never)} />
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change history"
            onPress={() => router.push(`/agents/${a.id}/history` as never)}
            style={({ pressed }) => [styles.link, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={[typography.label, { color: colors.primary }]}>Change history</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Publish to Explore"
            onPress={() => router.push(`/more/explore/publish/${a.id}` as never)}
            style={({ pressed }) => [styles.link, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={[typography.label, { color: colors.primary }]}>Publish to Explore</Text>
          </Pressable>
        </View>

        <View style={{ gap: spacing.md }}>
          <Text accessibilityRole="header" style={[typography.heading, { color: colors.text }]}>Recent runs</Text>
          {runs.isError ? (
            <ErrorText message={messageOf(runs.error, 'Could not load recent runs.')} />
          ) : null}
          {runs.isPending ? (
            <ActivityIndicator color={colors.primary} />
          ) : (runs.data ?? []).length === 0 ? (
            <Text style={[typography.body, { color: colors.mutedText }]}>
              No runs yet. Use Run agent to start one.
            </Text>
          ) : (
            (runs.data ?? []).map((run: ExecutionLog) => (
              <Pressable
                key={run.execution_id}
                accessibilityRole="button"
                accessibilityLabel={`Open run from ${formatRelative(run.created_at)}`}
                onPress={() => openRun(run.execution_id)}
                style={({ pressed }) => [
                  styles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    padding: spacing.md,
                    gap: spacing.xs,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <View style={styles.row}>
                  <StatusPill status={run.status} />
                  <Text style={[typography.caption, { color: colors.mutedText, flex: 1 }]}>
                    {formatRelative(run.created_at)}
                  </Text>
                  <Text style={[typography.caption, { color: colors.mutedText }]}>
                    {formatDuration(run.duration_ms)}
                  </Text>
                </View>
                {run.error_message ? (
                  <Text numberOfLines={2} style={[typography.caption, { color: colors.danger }]}>
                    {run.error_message}
                  </Text>
                ) : null}
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>

      {runOpen ? (
        <RunAgentSheet
          agentId={a.id}
          agentName={a.name}
          brief={a.brief ?? ''}
          onClose={() => setRunOpen(false)}
          onStarted={(executionId) => {
            setRunOpen(false);
            openRun(executionId);
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  tag: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingVertical: 2 },
  card: { borderWidth: StyleSheet.hairlineWidth },
  fact: { gap: 2 },
  link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xs },
});
