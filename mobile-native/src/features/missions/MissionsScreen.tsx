import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useRefresh } from '../../hooks/useRefresh';
import { useIsLive } from '../../hooks/usePolling';
import { messageOf } from '../agents/format';
import { spacing, typography, useTheme } from '../../theme';
import { MissionCard, isLiveMission } from './MissionCard';
import { StartMissionSheet } from './StartMissionSheet';
import { useMissions } from './queries';
import type { Mission } from './types';

/** Missions, live ones first. Starting one opens the sheet; a card opens its detail. */
export function MissionsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const watching = useIsLive();
  const missions = useMissions(watching);
  const [starting, setStarting] = useState(false);
  const [showFinished, setShowFinished] = useState(false);
  const { refreshing, onRefresh } = useRefresh(missions.refetch);

  const list = useMemo<Mission[]>(() => missions.data ?? [], [missions.data]);
  const live = useMemo(() => list.filter((m) => isLiveMission(m.status)), [list]);
  const finished = useMemo(() => list.filter((m) => !isLiveMission(m.status)), [list]);

  const startButton = (
    <Button title="Start a mission" onPress={() => setStarting(true)} />
  );

  if (missions.isPending) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <LoadingState text="Loading missions" />
      </Screen>
    );
  }

  if (missions.isError) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <ErrorState message={messageOf(missions.error, 'Missions could not be loaded.')} onRetry={() => void missions.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          A mission is a goal the agent keeps working on in the background, within a budget and a deadline. Its runs appear in Runs as they happen.
        </Text>
        {startButton}

        {list.length === 0 ? (
          <EmptyState
            title="No missions yet"
            message="Type /goal in chat to start one, or start one here. It shows the goal, budget and deadline before anything runs."
          />
        ) : (
          <>
            <Text style={[typography.caption, { color: colors.mutedText }]}>
              {`${live.length} live · ${finished.length} finished`}
            </Text>
            {live.map((m) => (
              <MissionCard key={m.id} mission={m} onPress={() => router.push(`/more/missions/${m.id}`)} />
            ))}
            {finished.length > 0 ? (
              <>
                <Button
                  title={showFinished ? 'Hide finished' : `Show finished (${finished.length})`}
                  variant="secondary"
                  onPress={() => setShowFinished((v) => !v)}
                />
                {showFinished
                  ? finished.map((m) => (
                      <MissionCard key={m.id} mission={m} onPress={() => router.push(`/more/missions/${m.id}`)} />
                    ))
                  : null}
              </>
            ) : null}
          </>
        )}
        <View style={{ height: spacing.lg }} />
      </ScrollView>

      <StartMissionSheet visible={starting} onClose={() => setStarting(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
});
