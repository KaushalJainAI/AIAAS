import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Coins,
  Hand,
  MessagesSquare,
  Network,
  ThumbsDown,
  Wrench,
} from 'lucide-react';
import { logsService, type InsightsOverview } from '../../api/logs';
import { costQualifier, describeCost, formatCost } from '../../lib/cost';
import {
  ChartLegend,
  RateTrend,
  RunsDayBars,
  SpendDayBars,
  StatusDonut,
  ToolShareBar,
} from './InsightsCharts';
import { parseCost, rateTextClass } from '../../lib/insights';

const RANGE_DAYS = { '7d': 7, '14d': 14, '30d': 30 } as const;
type TimeRange = keyof typeof RANGE_DAYS;

function Bar({ pct, tone = 'bg-primary/70' }: { pct: number; tone?: string }) {
  return (
    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
      <div className={`${tone} h-full rounded-full`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

function Card({ title, icon, children, action }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="bg-card border border-border/60 rounded-lg p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold flex items-center gap-2 text-sm">{icon}{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = s / 60;
  if (m < 60) return `${m.toFixed(1)}m`;
  return `${(m / 60).toFixed(1)}h`;
}

function delta(current: number, prev: number): string | null {
  if (!prev) return null;
  const pct = Math.round(((current - prev) / prev) * 100);
  if (pct === 0) return '±0%';
  return `${pct > 0 ? '+' : ''}${pct}% vs prior`;
}

function callouts(data: InsightsOverview) {
  const out: { title: string; body: string; to: string; cta: string }[] = [];
  const pending = data.agents.pending_hitl;
  if (pending > 0) {
    const median = data.agents.median_approve_ms;
    out.push({
      title: `${pending} approval${pending === 1 ? '' : 's'} waiting on you`,
      body: median != null
        ? `Blocked runs cannot finish until you answer. Median answer time lately: ${formatDuration(median)}.`
        : 'Blocked runs cannot finish until you answer. The oldest one is usually the one to clear first.',
      to: '/runs',
      cta: 'Answer them',
    });
  }
  const weak = data.agents.needs_attention[0];
  if (weak) {
    const agentParam = weak.workflow_id != null ? `?agent=${weak.workflow_id}&status=failed` : '?status=failed';
    out.push({
      title: `${weak.workflow_name} fails ${(100 - weak.success_rate).toFixed(0)}% of the time`,
      body: weak.example_error
        ? `Latest: ${weak.example_error.slice(0, 140)}`
        : `${weak.failed} of ${weak.runs} runs failed in this period. Open its recent runs and look at the failing tool first.`,
      to: weak.example_execution_id ? `/runs?run=${weak.example_execution_id}` : `/runs${agentParam}`,
      cta: 'Open the failing run',
    });
  }
  const spendy = data.agents.most_expensive[0];
  const totalTokens = data.spend.total_tokens || 0;
  if (spendy && totalTokens > 0) {
    const share = Math.round(((spendy.tokens || 0) / totalTokens) * 100);
    if (share >= 30 && data.agents.most_expensive.length > 1) {
      out.push({
        title: `${spendy.workflow_name} is ${share}% of agent spend`,
        body: 'One agent dominates the bill. Check which model it runs on — a cheaper model there saves more than anywhere else.',
        to: spendy.workflow_id != null ? `/runs?agent=${spendy.workflow_id}` : '/runs',
        cta: 'See its runs',
      });
    }
  }
  const badTool = [...data.tools].sort((a, b) => b.failed - a.failed)[0];
  if (badTool && badTool.failed >= 3) {
    out.push({
      title: `${badTool.tool} failed ${badTool.failed} times`,
      body: badTool.error
        ? `Latest: ${badTool.error.slice(0, 140)}`
        : 'The same tool failing repeatedly is usually a credential, a scope, or a prompt asking for something it cannot do.',
      to: badTool.execution_id ? `/runs?run=${badTool.execution_id}` : '/runs?status=failed',
      cta: 'Open the failing run',
    });
  }
  return out.slice(0, 3);
}

export default function InsightsDashboard() {
  const [range, setRange] = useState<TimeRange>('30d');
  const days = RANGE_DAYS[range];
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['insights-overview', days, 'compare'],
    queryFn: () => logsService.getOverview(days, true),
    staleTime: 60 * 1000,
  });

  const tips = useMemo(() => (data ? callouts(data) : []), [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Activity className="w-5 h-5 mr-2 animate-pulse" />
        Loading insights…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
        <p>Could not load insights.</p>
        <button onClick={() => refetch()} className="text-sm text-primary hover:underline">Try again</button>
      </div>
    );
  }

  const runs = data.runs.summary;
  const spend = data.spend;
  const allCost = spend.all_cost_usd ?? spend.total_cost_usd;
  const allSource = spend.all_cost_source ?? spend.total_cost_source;
  const totalRuns = runs.total_executions;
  const empty = totalRuns === 0 && (spend.chat?.messages ?? 0) === 0;

  if (empty) {
    return (
      <div className="space-y-6">
        <div className="bg-card p-6 rounded-lg border border-border">
          <h2 className="text-2xl font-bold tracking-tight">Insights</h2>
          <p className="text-muted-foreground">Your usage, cost, and execution activity</p>
        </div>
        <div className="text-center py-14 border border-dashed border-border/60 rounded-lg bg-card/30">
          <Activity className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-50" />
          <p className="font-medium">Nothing to analyse yet</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            Insights read your actual runs, chats and spend. Ask something in chat or run an agent,
            then come back — this page will break down what it cost, what worked, and what to fix.
          </p>
          <div className="mt-4 flex items-center justify-center gap-3 text-sm">
            <Link to="/ai-chat" className="text-primary hover:underline font-medium">Ask in chat</Link>
            <Link to="/agents" className="text-primary hover:underline font-medium">Run an agent</Link>
          </div>
        </div>
      </div>
    );
  }

  const byCaller = data.runs.by_caller ?? {};
  const callerTotal = Object.values(byCaller).reduce((a, b) => a + (b as number), 0) || 1;
  const daily = data.runs.daily_trend ?? [];
  const maxDaily = Math.max(...daily.map((d) => d.count), 1);
  const failures = Object.entries(data.quality.by_failure_category ?? {}).sort((a, b) => b[1] - a[1]);
  const signals = Object.entries(data.quality.signals_by_kind ?? {}).sort((a, b) => b[1] - a[1]);
  const usage = spend.daily_usage ?? [];
  const byKind = spend.by_kind ?? [];
  const prev = data.previous;
  const runsDelta = prev ? delta(totalRuns, prev.total_executions) : null;
  const spendDelta = null; // cost is a Decimal-string mix; compare counts, not money, until priced uniformly.

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card p-6 rounded-lg border border-border">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Insights</h2>
          <p className="text-muted-foreground">
            What your agents cost, what they did, and what needs you — last {days} days
            {prev && (
              <span className="ml-2 text-xs">
                {runsDelta && <span className="tabular-nums">{runsDelta} runs · </span>}
                {prev.chat_messages.toLocaleString()} chat answers prior
              </span>
            )}
          </p>
          <div className="mt-2"><ChartLegend /></div>
        </div>
        <div className="flex items-center gap-2 bg-muted/50 p-1 rounded-lg border border-border">
          {(Object.keys(RANGE_DAYS) as TimeRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                range === r
                  ? 'bg-background text-primary shadow-sm border border-border/50'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {tips.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {tips.map((t) => (
            <div key={t.title} className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
              <p className="text-sm font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />{t.title}
              </p>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{t.body}</p>
              <Link to={t.to} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                {t.cta}<ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" />Runs</p>
          <p className="text-2xl font-bold mt-1 tabular-nums">{totalRuns.toLocaleString()}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {data.agents.distinct} agents · {data.delegation.delegated_runs} delegated
            {runsDelta ? ` · ${runsDelta}` : ''}
          </p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground">Success rate</p>
          <p className={`text-2xl font-bold mt-1 tabular-nums ${rateTextClass(runs.success_rate)}`}>
            {runs.success_rate.toFixed(0)}%
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {runs.failed} failed · avg {formatDuration(runs.avg_duration_ms)}
            {prev ? ` · was ${prev.success_rate.toFixed(0)}%` : ''}
          </p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Coins className="w-3.5 h-3.5" />Model spend</p>
          <p className="text-2xl font-bold mt-1 tabular-nums" title={allCost ? describeCost(allCost, allSource) : undefined}>
            {formatCost(allCost, allSource)} <span className="text-xs font-normal text-muted-foreground">{costQualifier(allSource)}</span>
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {spend.chat ? `${spend.chat.messages} chat answers` : 'agents only'}
            {spendDelta ? ` · ${spendDelta}` : ''}
          </p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Hand className="w-3.5 h-3.5" />Needs you</p>
          <p className="text-2xl font-bold mt-1 tabular-nums">{data.agents.pending_hitl}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            pending approvals
            {data.agents.median_approve_ms != null ? ` · median ${formatDuration(data.agents.median_approve_ms)}` : ''}
          </p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5"><ThumbsDown className="w-3.5 h-3.5" />Feedback</p>
          <p className="text-2xl font-bold mt-1 tabular-nums">
            {data.quality.thumbs_up}<span className="text-muted-foreground text-base"> / {data.quality.thumbs_down}↓</span>
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">thumbs up / down</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card
          title="Where the money went"
          icon={<Coins className="w-4 h-4 text-emerald-500" />}
          action={<Link to="/runs" className="text-xs text-primary hover:underline">Runs</Link>}
        >
          {data.agents.most_expensive.length === 0 ? (
            <p className="text-sm text-muted-foreground">No priced runs in this period.</p>
          ) : (
            <ul className="space-y-3">
              {data.agents.most_expensive.slice(0, 6).map((a) => {
                const max = parseFloat(data.agents.most_expensive[0]?.cost_usd || '0') || 1;
                const here = parseFloat(a.cost_usd || '0') || 0;
                const to = a.workflow_id != null ? `/runs?agent=${a.workflow_id}` : '/runs';
                return (
                  <li key={`${a.workflow_id}-${a.workflow_name}`}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <Link to={to} className="font-medium truncate hover:underline">{a.workflow_name}</Link>
                      <span className="tabular-nums text-muted-foreground shrink-0" title={describeCost(a.cost_usd, a.cost_source)}>
                        {formatCost(a.cost_usd, a.cost_source)} · {a.runs} runs
                      </span>
                    </div>
                    <div className="mt-1"><Bar pct={(here / max) * 100} tone="bg-emerald-500/70" /></div>
                  </li>
                );
              })}
            </ul>
          )}
          {spend.by_model.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">Spend by model — downgrade the top bar first</p>
              <ul className="space-y-2">
                {spend.by_model.slice(0, 5).map((m) => {
                  const cost = parseCost(m.cost_usd);
                  const maxModel = Math.max(...spend.by_model.map((x) => parseCost(x.cost_usd)), 0) || 1;
                  return (
                    <li key={`${m.provider}/${m.model_id}`}>
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="font-mono truncate" title={`${m.provider}/${m.model_id}`}>
                          {m.model_id}
                        </span>
                        <span className="tabular-nums text-muted-foreground shrink-0">
                          {formatCost(m.cost_usd, allSource)} · {m.turns} turns
                        </span>
                      </div>
                      <div className="mt-1"><Bar pct={(cost / maxModel) * 100} tone="bg-emerald-500/70" /></div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {byKind.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              Non-token: {byKind.slice(0, 4).map((k) => `${k.kind} ₹${k.amount_inr.toLocaleString()}${k.estimated ? ' (est.)' : ''}`).join(' · ')}
            </p>
          )}
          {spend.agents_by_cost_source && (
            <p className="text-[11px] text-muted-foreground mt-2">
              Runs: {spend.agents_by_cost_source.billed} charged · {spend.agents_by_cost_source.estimated} estimated · {spend.agents_by_cost_source.unpriced} unpriced
              {spend.chat ? ` · chat paid by you ${spend.chat.paid_by.own_key} / platform ${spend.chat.paid_by.platform}` : ''}
            </p>
          )}
        </Card>

        <Card
          title="Most-used agents"
          icon={<Bot className="w-4 h-4 text-primary" />}
          action={<Link to="/agents" className="text-xs text-primary hover:underline">Agents</Link>}
        >
          {data.agents.most_active.length === 0 ? (
            <p className="text-sm text-muted-foreground">No agent runs in this period.</p>
          ) : (
            <ul className="space-y-3">
              {data.agents.most_active.slice(0, 6).map((a) => {
                const max = data.agents.most_active[0]?.runs || 1;
                const to = a.workflow_id != null ? `/runs?agent=${a.workflow_id}` : '/runs';
                return (
                  <li key={`${a.workflow_id}-${a.workflow_name}`}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <Link to={to} className="font-medium truncate hover:underline">{a.workflow_name}</Link>
                      <span className="tabular-nums text-muted-foreground shrink-0">
                        {a.runs} runs · <span className={`font-medium ${rateTextClass(a.success_rate)}`}>{a.success_rate.toFixed(0)}% ok</span>
                      </span>
                    </div>
                    <div className="mt-1"><Bar pct={(a.runs / max) * 100} /></div>
                    {a.example_execution_id && (
                      <Link to={`/runs?run=${a.example_execution_id}`} className="text-[11px] text-primary hover:underline">
                        Open latest failure
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card
          title="Tools: most called, and what fails"
          icon={<Wrench className="w-4 h-4 text-blue-500" />}
          action={<Link to="/tools" className="text-xs text-primary hover:underline">Tool library</Link>}
        >
          {data.tools.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tool calls recorded in this period.</p>
          ) : (
            <ul className="space-y-3">
              {data.tools.slice(0, 8).map((t) => (
                <li key={t.tool}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-mono text-[13px] truncate" title={t.error || undefined}>{t.tool}</span>
                    <span className="tabular-nums shrink-0 text-xs text-muted-foreground">
                      {t.calls} calls{t.failed > 0 ? <span className="text-red-500 font-medium"> · {t.failed} failed</span> : ''} ·{' '}
                      <span className={`font-medium ${rateTextClass(t.success_rate)}`}>{t.success_rate.toFixed(0)}%</span>
                    </span>
                  </div>
                  {/* Width is volume, the red segment is failures: the old bar
                      drew the rate as a width, so a 2-call tool looked busier
                      than a 200-call one at 95%. */}
                  <div className="mt-1">
                    <ToolShareBar
                      calls={t.calls}
                      failed={t.failed}
                      maxCalls={Math.max(...data.tools.map((x) => x.calls), 1)}
                    />
                  </div>
                  {t.execution_id && (
                    <Link to={`/runs?run=${t.execution_id}`} className="text-[11px] text-primary hover:underline">
                      Open failing run{t.error ? ` — ${t.error.slice(0, 100)}` : ''}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Activity" icon={<Activity className="w-4 h-4 text-primary" />}>
          {daily.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs on these days.</p>
          ) : (
            <>
              <RunsDayBars daily={daily} max={maxDaily} />
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Runs per day — emerald succeeded, red everything else. Hover a bar for the split.
              </p>
            </>
          )}
          {usage.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">Spend per day</p>
              <SpendDayBars
                daily={usage.map((u) => ({ date: u.date, cost: parseCost(u.cost_usd) }))}
                max={Math.max(...usage.map((u) => parseCost(u.cost_usd)), 0)}
              />
            </div>
          )}
          <div className="mt-4 space-y-1.5">
            {Object.entries(byCaller).map(([caller, n]) => (
              <div key={caller} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 text-muted-foreground capitalize">{caller === 'orchestrator' ? 'sub-agents' : caller}</span>
                <div className="flex-1"><Bar pct={((n as number) / callerTotal) * 100} tone="bg-muted-foreground/50" /></div>
                <span className="w-10 text-right tabular-nums">{n as number}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-3 flex items-center gap-1.5">
            <MessagesSquare className="w-3 h-3" />
            {spend.chat ? `${spend.chat.messages} chat answers · ${spend.chat.tokens.toLocaleString()} tokens` : 'No chat traffic priced in this period'}
          </p>
        </Card>

        <Card
          title="Reliability"
          icon={<Activity className="w-4 h-4 text-emerald-500" />}
          action={<Link to="/runs?status=failed" className="text-xs text-primary hover:underline">Failed runs</Link>}
        >
          <p className="text-xs font-medium text-muted-foreground mb-2">Success rate per day</p>
          {daily.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs on these days.</p>
          ) : (
            <>
              <RateTrend daily={daily} />
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Dashed amber is 80%. Empty days break the line — nothing ran, so there is no rate to plot.
              </p>
            </>
          )}
          <div className="mt-4">
            <p className="text-xs font-medium text-muted-foreground mb-2">Outcomes in this period</p>
            <StatusDonut byStatus={data.runs.by_status ?? {}} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card
          title="Orchestration"
          icon={<Network className="w-4 h-4 text-violet-500" />}
          action={<Link to="/runs" className="text-xs text-primary hover:underline">Delegated runs</Link>}
        >
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-semibold tabular-nums">{data.delegation.delegated_runs}</span> worker runs
            started by other agents in this period.
          </p>
          {data.delegation.top_workers.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">Most-delegated to</p>
              <ul className="space-y-1.5 text-sm">
                {data.delegation.top_workers.slice(0, 5).map((w) => (
                  <li key={`${w.workflow_id}-${w.workflow_name}`} className="flex justify-between gap-2">
                    {w.workflow_id != null ? (
                      <Link to={`/runs?agent=${w.workflow_id}`} className="truncate hover:underline">{w.workflow_name}</Link>
                    ) : (
                      <span className="truncate">{w.workflow_name}</span>
                    )}
                    <span className="tabular-nums text-muted-foreground shrink-0">{w.runs} runs</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.delegation.top_orchestrators.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">Delegates the most</p>
              <ul className="space-y-1.5 text-sm">
                {data.delegation.top_orchestrators.slice(0, 5).map((o) => (
                  <li key={`${o.workflow_id}-${o.workflow_name}`} className="flex justify-between gap-2">
                    {o.workflow_id != null ? (
                      <Link to={`/runs?agent=${o.workflow_id}`} className="truncate hover:underline">{o.workflow_name}</Link>
                    ) : (
                      <span className="truncate">{o.workflow_name}</span>
                    )}
                    <span className="tabular-nums text-muted-foreground shrink-0">{o.delegated_runs} workers</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.delegation.delegated_runs === 0 && (
            <p className="text-xs text-muted-foreground mt-3">No delegation yet — a single agent answering directly leaves no fan-out to show.</p>
          )}
        </Card>

        <Card title="What to fix" icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}>
          {failures.length === 0 && data.quality.thumbs_down === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing failing and no thumbs-down in this period.</p>
          ) : (
            <div className="space-y-3 text-sm">
              {failures.slice(0, 5).map(([cat, n]) => (
                <div key={cat} className="flex justify-between gap-2">
                  <Link to={`/runs?status=failed&failure_category=${cat}`} className="capitalize hover:underline">
                    {cat.replace('_', ' ')}
                  </Link>
                  <span className="tabular-nums text-muted-foreground">{n} runs</span>
                </div>
              ))}
              {signals.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Signals: {signals.slice(0, 4).map(([k, n]) => `${k} (${n})`).join(' · ')}
                </p>
              )}
              {data.quality.thumbs_down > 0 && (
                <p className="text-xs text-muted-foreground">
                  {data.quality.thumbs_down} thumbs-down
                  {Object.entries(data.quality.thumbs_down_by_reason).slice(0, 3).map(([r, n]) => ` · ${r} (${n})`).join('')}
                </p>
              )}
              {data.quality.recent_thumbs_down.slice(0, 3).map((f) => (
                <p key={`${f.type}-${f.id}`} className="text-xs text-muted-foreground truncate">
                  ↓ {f.agent || f.type}{f.reason ? ` — ${f.reason}` : ''}{f.comment ? `: ${f.comment}` : ''}
                  {f.type === 'execution' && (
                    <Link to={`/runs?run=${f.id}`} className="ml-2 text-primary hover:underline">Open</Link>
                  )}
                </p>
              ))}
              {data.agents.needs_attention.slice(0, 3).map((a) => (
                <div key={`na-${a.workflow_id}-${a.workflow_name}`} className="flex justify-between gap-2 text-xs">
                  <span className="truncate">{a.workflow_name} · {a.success_rate.toFixed(0)}% ok</span>
                  {a.example_execution_id ? (
                    <Link to={`/runs?run=${a.example_execution_id}`} className="text-primary hover:underline shrink-0">Open failure</Link>
                  ) : a.workflow_id != null ? (
                    <Link to={`/runs?agent=${a.workflow_id}&status=failed`} className="text-primary hover:underline shrink-0">See runs</Link>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
