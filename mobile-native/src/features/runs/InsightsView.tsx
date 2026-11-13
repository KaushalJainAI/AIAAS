import { useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Text } from '../../components/Text';
import { useRefresh } from '../../hooks/useRefresh';
import { messageOf } from '../agents/format';
import { spacing, typography, useTheme } from '../../theme';
import { BarRow, ColumnChart, HorizontalBars } from './charts';
import {
  compactNumber,
  costQualifier,
  FAILURE_LABEL,
  formatCostInr,
  inrValue,
  percent,
} from './format';
import { useInsightsOverview } from './queries';
import type { FailureCategory, OverviewAgentRow, OverviewToolRow } from './types';

const RANGES = [
  { key: '7', label: '7 days', count: 0 },
  { key: '14', label: '14 days', count: 0 },
  { key: '30', label: '30 days', count: 0 },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Nov", from the server's YYYY-MM-DD day. */
function shortDay(day: string | null): string {
  if (!day) return '';
  const parts = day.split('-').map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return day;
  return `${parts[2]} ${MONTHS[parts[1] - 1] ?? ''}`;
}

function changeText(current: number, previous: number | undefined): string | null {
  if (!previous) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return '±0% vs prior';
  return `${pct > 0 ? '+' : ''}${pct}% vs prior`;
}

/** Overview, costs and quality for the last 7, 14 or 30 days. */
export function InsightsView() {
  const { colors } = useTheme();
  const router = useRouter();
  const [range, setRange] = useState<RangeKey>('30');
  const days = Number(range);
  const query = useInsightsOverview(days, true);
  const { refreshing, onRefresh } = useRefresh(query.refetch);

  if (query.isPending) return <LoadingState text="Loading insights" />;
  if (query.isError || !query.data) {
    return (
      <ErrorState
        message={messageOf(query.error, 'Insights could not be loaded.')}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const data = query.data;
  const runs = data.runs.summary;
  const spend = data.spend;
  const allCost = spend.all_cost_usd ?? spend.total_cost_usd;
  const allSource = spend.all_cost_source ?? spend.total_cost_source;
  const empty = runs.total_executions === 0 && (spend.chat?.messages ?? 0) === 0;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <SegmentedControl items={RANGES.map((r) => ({ ...r }))} value={range} onChange={setRange} />

      {empty ? (
        <EmptyState
          title="Nothing to analyse yet"
          message="Insights read your actual runs, chats and spend. Ask something in chat or run an agent, then come back."
        />
      ) : (
        <>
          <View style={styles.grid}>
            <StatCard
              label="Runs"
              value={String(runs.total_executions)}
              note={changeText(runs.total_executions, data.previous?.total_executions)}
            />
            <StatCard
              label="Success rate"
              value={percent(runs.success_rate)}
              note={data.previous ? `${percent(data.previous.success_rate)} before` : null}
            />
            <StatCard
              label="Spend"
              value={formatCostInr(allCost, allSource)}
              note={costQualifier(allSource) || null}
            />
            <StatCard label="Tokens" value={compactNumber(spend.total_tokens)} note={null} />
          </View>

          <Section title="Runs per day">
            <ColumnChart
              values={data.runs.daily_trend.map((p) => p.count)}
              overlay={data.runs.daily_trend.map((p) => p.success)}
              firstLabel={shortDay(data.runs.daily_trend[0]?.date ?? null)}
              lastLabel={shortDay(data.runs.daily_trend[data.runs.daily_trend.length - 1]?.date ?? null)}
            />
            <Caption>Green is the part that succeeded.</Caption>
          </Section>

          <Section title="Where the money went">
            {spend.daily_usage.length > 0 ? (
              <ColumnChart
                values={spend.daily_usage.map((p) => inrValue(p.cost_usd))}
                firstLabel={shortDay(spend.daily_usage[0]?.date ?? null)}
                lastLabel={shortDay(spend.daily_usage[spend.daily_usage.length - 1]?.date ?? null)}
              />
            ) : null}
            {spend.by_model.length > 0 ? (
              <HorizontalBars rows={topRows(spend.by_model.map((m) => ({
                label: m.model_id,
                value: inrValue(m.cost_usd),
                display: formatCostInr(m.cost_usd, 'billed'),
              })))} />
            ) : (
              <Caption>No model spend in this period.</Caption>
            )}
            {(spend.by_kind ?? []).length > 0 ? (
              <HorizontalBars rows={topRows((spend.by_kind ?? []).map((k) => ({
                label: k.kind,
                value: k.amount_inr,
                display: `₹${Math.round(k.amount_inr).toLocaleString('en-IN')}`,
              })))} />
            ) : null}
            {spend.chat ? (
              <Caption>{`Chats: ${spend.chat.messages} messages, ${formatCostInr(spend.chat.cost_usd, spend.chat.cost_source)}.`}</Caption>
            ) : null}
          </Section>

          {data.agents.most_active.length > 0 ? (
            <Section title="Most-used agents">
              {data.agents.most_active.slice(0, 5).map((row) => (
                <AgentLine key={`${row.workflow_id}-${row.workflow_name}`} row={row} />
              ))}
            </Section>
          ) : null}

          {data.agents.most_expensive.length > 0 ? (
            <Section title="Most expensive">
              {data.agents.most_expensive.slice(0, 5).map((row) => (
                <AgentLine key={`cost-${row.workflow_id}-${row.workflow_name}`} row={row} />
              ))}
            </Section>
          ) : null}

          {data.agents.needs_attention.length > 0 ? (
            <Section title="What to fix">
              {data.agents.needs_attention.slice(0, 3).map((row) => (
                <View key={`fix-${row.workflow_id}-${row.workflow_name}`} style={{ gap: 2 }}>
                  <AgentLine row={row} />
                  {row.example_error ? (
                    <Caption>{`Latest: ${row.example_error.slice(0, 140)}`}</Caption>
                  ) : null}
                </View>
              ))}
            </Section>
          ) : null}

          <Section title="Quality">
            <View style={styles.statLine}>
              <Text style={[typography.label, { color: colors.text }]}>{`${data.quality.thumbs_up} good`}</Text>
              <Text style={[typography.label, { color: colors.text }]}>{`${data.quality.thumbs_down} bad`}</Text>
            </View>
            {failureRows(data.quality.by_failure_category).length > 0 ? (
              <HorizontalBars tone="danger" rows={failureRows(data.quality.by_failure_category)} />
            ) : (
              <Caption>No failures in this period.</Caption>
            )}
            {Object.entries(data.quality.thumbs_down_by_reason).length > 0 ? (
              <Caption>
                {`Bad ratings: ${Object.entries(data.quality.thumbs_down_by_reason)
                  .map(([reason, n]) => `${reason.replace(/_/g, ' ')} ${n}`)
                  .join(', ')}`}
              </Caption>
            ) : null}
          </Section>

          {data.tools.length > 0 ? (
            <Section title="Tools">
              {data.tools.slice(0, 8).map((tool) => (
                <ToolLine key={tool.tool} row={tool} />
              ))}
            </Section>
          ) : null}

          {data.agents.pending_hitl > 0 ? (
            <Section title="Waiting on you">
              <Caption>
                {`${data.agents.pending_hitl} approval${data.agents.pending_hitl === 1 ? '' : 's'} blocked until you answer.`}
              </Caption>
              <Button title="Answer in the Inbox" variant="secondary" onPress={() => router.push('/inbox')} />
            </Section>
          ) : null}

          {data.delegation.delegated_runs > 0 ? (
            <Section title="Delegation">
              <Caption>{`${data.delegation.delegated_runs} runs were started by other agents.`}</Caption>
            </Section>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function topRows(rows: BarRow[], limit = 6): BarRow[] {
  return [...rows].sort((a, b) => b.value - a.value).slice(0, limit);
}

function failureRows(categories: Record<string, number>): BarRow[] {
  return Object.entries(categories)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => ({
      label: FAILURE_LABEL[key as FailureCategory] ?? key,
      value: n,
      display: String(n),
    }));
}

function StatCard({ label, value, note }: { label: string; value: string; note: string | null }) {
  const { colors } = useTheme();
  return (
    <Card style={styles.stat}>
      <Text style={[typography.caption, { color: colors.mutedText }]}>{label}</Text>
      <Text style={[typography.heading, { color: colors.text }]}>{value}</Text>
      {note ? <Text style={[typography.caption, { color: colors.mutedText }]}>{note}</Text> : null}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Card style={{ gap: spacing.md }}>
      <Text accessibilityRole="header" style={[typography.label, { color: colors.text }]}>
        {title}
      </Text>
      {children}
    </Card>
  );
}

function Caption({ children }: { children: string }) {
  const { colors } = useTheme();
  return <Text style={[typography.caption, { color: colors.mutedText }]}>{children}</Text>;
}

function AgentLine({ row }: { row: OverviewAgentRow }) {
  const { colors } = useTheme();
  return (
    <View style={styles.statLine}>
      <Text style={[typography.body, styles.grow, { color: colors.text }]} numberOfLines={1}>
        {row.workflow_name}
      </Text>
      <Text style={[typography.caption, { color: colors.mutedText }]}>
        {`${row.runs} runs · ${percent(row.success_rate)} · ${formatCostInr(row.cost_usd, row.cost_source)}`}
      </Text>
    </View>
  );
}

function ToolLine({ row }: { row: OverviewToolRow }) {
  const { colors } = useTheme();
  return (
    <View style={styles.statLine}>
      <Text style={[typography.body, styles.grow, { color: colors.text }]} numberOfLines={1}>
        {row.tool}
      </Text>
      <Text style={[typography.caption, { color: row.failed > 0 ? colors.danger : colors.mutedText }]}>
        {`${row.calls} calls · ${percent(row.success_rate)}${row.failed > 0 ? ` · ${row.failed} failed` : ''}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingBottom: spacing.xl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  stat: { width: '48%', flexGrow: 1, gap: spacing.xs },
  statLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  grow: { flex: 1 },
});

