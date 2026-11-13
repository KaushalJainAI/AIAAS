import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { Button } from '../../../src/components/Button';
import { EmptyState } from '../../../src/components/EmptyState';
import { ErrorText } from '../../../src/components/ErrorText';
import { Icon } from '../../../src/components/Icon';
import { Screen } from '../../../src/components/Screen';
import { Text } from '../../../src/components/Text';
import { TextField } from '../../../src/components/TextField';
import { AGENT_STATUS_LABEL, formatRelative, messageOf } from '../../../src/features/agents/format';
import { StatusPill } from '../../../src/features/agents/StatusPill';
import { useAgents, useRecentRuns } from '../../../src/features/agents/queries';
import type { Agent, ExecutionLog } from '../../../src/features/agents/types';
import { useTheme } from '../../../src/theme';

/** The newest run for each agent, from a list already sorted newest first. */
function lastRunByAgent(runs: ExecutionLog[] | undefined): Map<number, ExecutionLog> {
  const byAgent = new Map<number, ExecutionLog>();
  for (const run of runs ?? []) {
    if (run.workflow_id != null && !byAgent.has(run.workflow_id)) byAgent.set(run.workflow_id, run);
  }
  return byAgent;
}

function matches(agent: Agent, needle: string): boolean {
  if (!needle) return true;
  const haystack = [agent.name, agent.description, ...(agent.tags ?? [])].join(' ').toLowerCase();
  return haystack.includes(needle);
}

export default function AgentsScreen() {
  const router = useRouter();
  const { colors, spacing, fontSize, radius } = useTheme();
  const agents = useAgents();
  const recent = useRecentRuns();
  const [search, setSearch] = useState('');

  const needle = search.trim().toLowerCase();
  const lastRuns = useMemo(() => lastRunByAgent(recent.data), [recent.data]);
  // Archived agents are filed away: hidden from the list, not deleted.
  const visible = useMemo(
    () => (agents.data ?? []).filter((a) => a.status !== 'archived' && matches(a, needle)),
    [agents.data, needle],
  );

  const refreshing = agents.isRefetching || recent.isRefetching;
  const refresh = () => {
    void agents.refetch();
    void recent.refetch();
  };

  if (agents.isPending) {
    return (
      <Screen edges={['left', 'right']}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (agents.isError) {
    return (
      <Screen edges={['left', 'right']}>
        <ErrorText message={messageOf(agents.error, 'Could not load your agents.')} />
        <View style={{ marginTop: spacing.md }}>
          <Button title="Try again" variant="secondary" onPress={refresh} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New agent"
              hitSlop={8}
              onPress={() => router.push('/agents/new')}
              style={({ pressed }) => ({ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
            >
              <Icon name="add" size={26} color={colors.primary} />
            </Pressable>
          ),
        }}
      />
      <TextField
        label="Search agents"
        value={search}
        onChangeText={setSearch}
        placeholder="Name, description or tag"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
      <FlatList
        style={{ marginTop: spacing.lg }}
        data={visible}
        keyExtractor={(agent) => String(agent.id)}
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl, flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          <EmptyState
            title={needle ? 'No agents match' : 'No agents yet'}
            message={
              needle
                ? 'Try a different word.'
                : 'Tap + to describe one, or start from a template in Explore.'
            }
          />
        }
        renderItem={({ item }) => {
          const last = lastRuns.get(item.id);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.name}`}
              onPress={() => router.push(`/agents/${item.id}`)}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  padding: spacing.lg,
                  gap: spacing.sm,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <View style={styles.titleRow}>
                <Text
                  numberOfLines={1}
                  style={{ flex: 1, color: colors.text, fontSize: fontSize.lg, fontWeight: '600' }}
                >
                  {item.name}
                </Text>
                <Text style={{ color: colors.mutedText, fontSize: fontSize.sm }}>
                  {AGENT_STATUS_LABEL[item.status] ?? item.status}
                </Text>
              </View>
              {item.description ? (
                <Text
                  numberOfLines={2}
                  style={{ color: colors.mutedText, fontSize: fontSize.md }}
                >
                  {item.description}
                </Text>
              ) : null}
              <View style={styles.titleRow}>
                {last ? (
                  <>
                    <StatusPill status={last.status} />
                    <Text style={{ color: colors.mutedText, fontSize: fontSize.sm, flex: 1 }}>
                      {formatRelative(last.created_at)}
                    </Text>
                  </>
                ) : (
                  <Text style={{ color: colors.mutedText, fontSize: fontSize.sm }}>No runs yet</Text>
                )}
              </View>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderWidth: StyleSheet.hairlineWidth },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
