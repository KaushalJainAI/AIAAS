import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorState } from '../../components/ErrorState';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { spacing, typography, useTheme } from '../../theme';
import { messageOf } from './form';
import { answeredPercent, problemFromQuery, scopeParam } from './page';
import { useSolutionInsights } from './queries';

/**
 * The Insights tab, for curators: what the team searched for and found over the
 * last 30 days. The server decides who sees it; this shows whatever it answers.
 * A question nobody answered can be answered in place.
 */
export function TeamInsights({ org, orgName }: { org: number; orgName: string | undefined }) {
  const router = useRouter();
  const { colors } = useTheme();
  const insights = useSolutionInsights(org);

  if (insights.isPending) return <LoadingState text="Loading insights" />;
  if (insights.isError) {
    return <ErrorState message={messageOf(insights.error, 'The insights could not be loaded.')} onRetry={() => void insights.refetch()} />;
  }
  const data = insights.data;
  const openAnswer = (problem: string) =>
    router.push(`/more/team/form?org=${org}&problem=${encodeURIComponent(problem)}`);

  return (
    <View style={styles.stack}>
      <Text style={[typography.caption, { color: colors.mutedText }]}>
        The last 30 days in {orgName ?? 'your organisation'}. Only curators see this page.
      </Text>

      <View style={styles.tiles}>
        <Tile label="Searches from chat" value={String(data.searches)} />
        <Tile
          label="Answered"
          value={answeredPercent(data.answered, data.searches)}
          hint={data.searches > 0 ? `${data.unanswered} with nothing found` : undefined}
        />
        <Tile label="Active solutions" value={String(data.solutions.active)} />
        <Tile
          label="Needs attention"
          value={String(data.solutions.needs_attention)}
          hint={data.solutions.needs_attention > 0 ? 'Still true or edit them' : undefined}
        />
      </View>

      <Section title="Most used">
        {data.top_used.length === 0 ? (
          <ListRow title="No chat answer has used a team solution yet." chevron={false} />
        ) : (
          data.top_used.map((row) => (
            <ListRow
              key={row.id}
              title={row.problem}
              detail={`${row.uses} ${row.uses === 1 ? 'use' : 'uses'}`}
              onPress={() => router.push(`/more/team/${row.id}?org=${scopeParam(org)}`)}
            />
          ))
        )}
      </Section>

      <Section title="Questions nobody has answered yet">
        {data.gaps.length === 0 ? (
          <ListRow
            title={
              data.searches === 0
                ? 'Nobody has asked the assistant a question in this team yet.'
                : 'Every question asked in the last 30 days found an answer.'
            }
            chevron={false}
          />
        ) : (
          data.gaps.map((gap) => (
            <Card key={gap.query}>
              <Text style={[typography.body, { color: colors.text }]}>{problemFromQuery(gap.query)}</Text>
              <Text style={[typography.caption, { color: colors.mutedText }]}>
                Asked {gap.times} {gap.times === 1 ? 'time' : 'times'}
              </Text>
              <View style={styles.gapAction}>
                <Button title="Write the answer" variant="secondary" onPress={() => openAnswer(problemFromQuery(gap.query))} />
              </View>
            </Card>
          ))
        )}
      </Section>
    </View>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const { colors } = useTheme();
  return (
    <Card style={styles.tile}>
      <Text style={[typography.caption, { color: colors.mutedText }]}>{label}</Text>
      <Text style={[typography.title, { color: colors.text }]}>{value}</Text>
      {hint ? <Text style={[typography.caption, { color: colors.mutedText }]}>{hint}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.xl, paddingBottom: spacing.xl },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { flexBasis: '47%', flexGrow: 1, gap: spacing.xs },
  gapAction: { marginTop: spacing.md },
});
