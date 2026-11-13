import { router, Stack } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';

import { ErrorState } from '../../components/ErrorState';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { useRefresh } from '../../hooks/useRefresh';
import { monthSpendLabel } from '../runs/spend';
import { useSpendSummary } from '../runs/queries';
import { tierLabel } from '../settings/format';
import { spacing, typography, useTheme } from '../../theme';
import { useAccountProfile } from './queries';

/**
 * Credits, plan and this month's spend, with the way into Insights. The web's
 * Usage tab, in the same words.
 */
export function UsageScreen() {
  const { colors } = useTheme();
  const profile = useAccountProfile();
  const spend = useSpendSummary();
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([profile.refetch(), spend.refetch()]));

  if (profile.isPending) return <LoadingState text="Loading usage" />;
  if (profile.isError || !profile.data) {
    return <ErrorState message="Could not load your usage. Check your connection and try again." onRetry={() => void profile.refetch()} />;
  }

  const spendLabel = spend.data ? monthSpendLabel(spend.data) : null;

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: 'Usage' }} />
      <ScrollView
        contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={{ gap: spacing.xs }}>
          <Text style={typography.heading} accessibilityRole="header">Usage</Text>
          <Text style={[typography.body, { color: colors.mutedText }]}>
            Early access is free. Each account has a credit allowance so one runaway agent cannot spend it all.
          </Text>
        </View>

        <Section footer="One credit covers roughly 1,000 tokens of model usage on the platform key.">
          <ListRow title="Credits remaining" detail={profile.data.credits.toLocaleString()} chevron={false} />
        </Section>

        <Section footer="Free models and calls made with your own provider keys never use credits.">
          <ListRow title="Plan" detail={tierLabel(profile.data.tier)} chevron={false} />
        </Section>

        <Section>
          <ListRow
            title="Spend this month"
            subtitle={spend.isPending ? 'Loading…' : spend.isError ? 'Could not load spend.' : undefined}
            detail={spendLabel ? undefined : spend.isSuccess ? 'Nothing yet' : undefined}
            chevron={false}
          />
          {spendLabel ? <ListRow title={spendLabel} chevron={false} /> : null}
        </Section>

        <Section title="Insights" footer="Runs, cost, quality and the questions people ask most, on the Runs page.">
          <ListRow
            icon="bar-chart-outline"
            title="Open insights"
            subtitle="Analyze your agents' performance and cost"
            onPress={() => router.push('/more/runs')}
          />
        </Section>
      </ScrollView>
    </Screen>
  );
}
