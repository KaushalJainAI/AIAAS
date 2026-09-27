/**
 * Evals — suites of cases run against an agent, and the human review of what
 * the graders decided.
 *
 * The backend for this has existed since the eval app landed; nothing in this
 * app called it, so the feature was unreachable. The page is built around the
 * one idea that makes the backend's design legible:
 *
 *   **a score is provisional until a person has been asked.**
 *
 * So `passed === null` on an `awaiting_review` run is rendered as its own
 * state, never as a failure and never as a blank, and the review queue is the
 * first tab rather than a detail buried under a run — it is the only part of
 * this feature that is waiting on a human.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Activity, AlertCircle, Check, ChevronRight, ClipboardCheck, FlaskConical,
  HelpCircle, Loader2, Pencil, Play, Plus, Trash2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import PageHeader from '../components/layout/PageHeader';
import MarkdownMessage from '../components/chat/MarkdownMessage';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/Button';
import evalsService, {
  isDraft, type EvalCase, type EvalRun, type EvalSuite, type GatedCalls, type QueueItem, type SupervisionPolicy, type Verdict,
} from '../api/evals';
import agentsService from '../api/agents';
import DraftCases from '../components/evals/DraftCases';
import CaseEditor from '../components/evals/CaseEditor';
import WorldCard from '../components/evals/WorldCard';
import IntentList from '../components/evals/IntentList';
import { cn } from '../lib/utils';
import { usePersistedState } from '../hooks/usePersistedState';

type Tab = 'review' | 'suites' | 'runs' | 'quality';

/** Why each policy exists, in the terms the backend documents them in. */
const SUPERVISION_HELP: Record<SupervisionPolicy, string> = {
  none: 'Trust the graders. Nothing is queued for review.',
  failures: 'Queue every result the graders failed. A failing case is always worth a human minute.',
  disagreement: 'Queue only the results where the judge and the exact checks disagree, or the judge was uncertain. The default, and the only policy whose review cost does not grow with the suite.',
  sampled: 'Queue a random percentage of results.',
  all: 'Queue every result. Thorough, and the most expensive in your time.',
};

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  awaiting_review: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  running: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  queued: 'bg-muted text-muted-foreground',
  failed: 'bg-red-500/10 text-red-600 dark:text-red-400',
  cancelled: 'bg-muted text-muted-foreground',
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn(
      'px-2 py-0.5 rounded-md text-[11px] font-medium capitalize whitespace-nowrap',
      STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground',
    )}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

/** A score that can still move must not be shown as if it were final. */
function ScoreCell({ run }: { run: Pick<EvalRun, 'score' | 'passed' | 'status' | 'pending_review_count'> }) {
  if (run.status === 'awaiting_review' || run.passed === null) {
    return (
      <span className="text-xs text-amber-600 dark:text-amber-400" title="Provisional — results are still waiting on a reviewer.">
        {run.score === null ? '—' : `${Math.round(run.score * 100)}%`} provisional
        {run.pending_review_count > 0 && ` · ${run.pending_review_count} to review`}
      </span>
    );
  }
  if (run.score === null) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className={cn('text-xs font-semibold', run.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
      {Math.round(run.score * 100)}% {run.passed ? 'pass' : 'fail'}
    </span>
  );
}

export default function Evals() {
  const queryClient = useQueryClient();
  const [tab, setTab] = usePersistedState<Tab>('evals.tab', 'review', { storage: 'session' });
  const [showCreate, setShowCreate] = useState(false);
  const [openSuite, setOpenSuite] = useState<number | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);

  const suitesQuery = useQuery({
    queryKey: ['eval', 'suites'],
    queryFn: () => evalsService.listSuites(),
    staleTime: 30_000,
  });

  const runsQuery = useQuery({
    queryKey: ['eval', 'runs'],
    queryFn: () => evalsService.listRuns(),
    // A sweep is one agent run per case, so a run list left open goes stale
    // fast. Cheap poll rather than a socket: this page is not the hot path.
    refetchInterval: 15_000,
  });

  const queueQuery = useQuery({
    queryKey: ['eval', 'queue'],
    queryFn: () => evalsService.reviewQueue(),
    staleTime: 15_000,
  });

  const qualityQuery = useQuery({
    queryKey: ['eval', 'quality'],
    queryFn: async () => {
      const { logsService } = await import('../api');
      return logsService.quality(30) as Promise<unknown> as Promise<Record<string, unknown>>;
    },
    staleTime: 60_000,
    enabled: tab === 'quality',
  });

  const judgeQuery = useQuery({
    queryKey: ['eval', 'judge'],
    queryFn: () => evalsService.judgeCalibration(),
    staleTime: 5 * 60_000,
  });

  const agentsQuery = useQuery({
    queryKey: ['eval', 'agents'],
    queryFn: () => agentsService.list(),
    staleTime: 5 * 60_000,
  });

  const suites = suitesQuery.data?.suites ?? [];
  const runs = runsQuery.data ?? [];
  const queue = queueQuery.data ?? [];
  const agents = useMemo(
    () => (Array.isArray(agentsQuery.data) ? agentsQuery.data : []),
    [agentsQuery.data],
  );

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['eval'] });
  }, [queryClient]);

  const runSuite = useMutation({
    mutationFn: ({ suiteId, agentId }: { suiteId: number; agentId?: number }) =>
      evalsService.runSuite(suiteId, agentId ? { agent_id: agentId } : {}),
    onSuccess: () => {
      toast.success('Sweep started', { description: 'One agent run per case — this page refreshes as it goes.' });
      invalidate();
    },
    onError: (error: unknown) => {
      // 402 (budget) and 400 (no cases / retired model) both carry a sentence
      // worth showing verbatim; the backend writes them for a person.
      const detail = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error('Could not start the sweep', { description: detail ?? 'Please try again.' });
    },
  });

  const review = useMutation({
    mutationFn: ({ resultId, verdict }: { resultId: number; verdict: Verdict }) =>
      evalsService.submitReview(resultId, { verdict }),
    onSuccess: (result) => {
      if (result.deleted) toast.success('Errored result dismissed');
      invalidate();
    },
    onError: (error: unknown) => {
      const detail = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error('Could not save that verdict', { description: detail ?? 'Please try again.' });
    },
  });

  const removeSuite = useMutation({
    mutationFn: (id: number) => evalsService.deleteSuite(id),
    onSuccess: () => { toast.success('Suite deleted'); invalidate(); },
    onError: () => toast.error('Could not delete the suite'),
  });

  const removeRun = useMutation({
    mutationFn: (runId: string) => evalsService.deleteRun(runId),
    onSuccess: () => { toast.success('Eval sweep deleted'); invalidate(); },
    onError: (error: unknown) => {
      const detail = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error('Could not delete the sweep', { description: detail ?? 'Please try again.' });
    },
  });

  const pendingTotal = queue.length;

  return (
    // `h-full overflow-y-auto`, not `min-h-screen`: the shell's <main> is
    // `h-full overflow-hidden`, so a page that only declares a *minimum*
    // height owns no scroller and everything past the first screen is
    // simply unreachable.
    <div className="h-full overflow-y-auto bg-background">
      <PageHeader
        title="Evals"
        subtitle="Does this agent still do what it did last week — and do you agree with the grader?"
        icon={FlaskConical}
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition"
          >
            <Plus className="w-4 h-4" /> New suite
          </button>
        }
      />

      <div className="px-4 py-6 md:px-8 space-y-6">
        <JudgeCard data={judgeQuery.data as { calibrations?: Record<string, { judge_model: string; agreement: number; false_pass_rate: number; created_at: string }> } | null} />

        <div className="flex items-center gap-1 border-b border-border/60 overflow-x-auto scrollbar-none">
          {([
            ['review', 'Needs review', pendingTotal],
            ['suites', 'Suites', suites.length],
            ['runs', 'Runs', runs.length],
            ['quality', 'Quality', 0],
          ] as const).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setTab(key as Tab)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition',
                tab === key
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
              {count > 0 && (
                <span className={cn(
                  'ml-2 px-1.5 py-0.5 rounded text-[11px]',
                  key === 'review' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-muted text-muted-foreground',
                )}>{count}</span>
              )}
            </button>
          ))}
        </div>

        {tab === 'review' && (
          <ReviewQueue
            queue={queue}
            loading={queueQuery.isLoading}
            onVerdict={(resultId, verdict) => review.mutate({ resultId, verdict })}
            pendingId={review.isPending ? (review.variables?.resultId ?? null) : null}
          />
        )}

        {tab === 'suites' && (
          <>
            <StarterKitsCard agents={agents} onCloned={invalidate} />
            <SuiteList
              suites={suites}
              loading={suitesQuery.isLoading}
              agents={agents}
              openSuite={openSuite}
              onToggle={(id) => setOpenSuite((prev) => (prev === id ? null : id))}
              onRun={(suiteId, agentId) => runSuite.mutate({ suiteId, agentId })}
              runningId={runSuite.isPending ? (runSuite.variables?.suiteId ?? null) : null}
              onDelete={(id) => removeSuite.mutate(id)}
              onCreate={() => setShowCreate(true)}
            />
          </>
        )}

        {tab === 'runs' && (
          <RunList
            runs={runs}
            loading={runsQuery.isLoading}
            openRun={openRun}
            onToggle={(id) => setOpenRun((prev) => (prev === id ? null : id))}
            onDelete={(runId) => {
              if (window.confirm('Delete this eval sweep, its results, and its evaluation run traces? This cannot be undone.')) {
                removeRun.mutate(runId);
              }
            }}
            deletingId={removeRun.isPending ? (removeRun.variables ?? null) : null}
          />
        )}

        {tab === 'quality' && (
          <QualityTab data={qualityQuery.data as Record<string, unknown> | undefined} loading={qualityQuery.isLoading} />
        )}
      </div>

      {showCreate && (
        <CreateSuiteModal
          agents={agents}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); setTab('suites'); invalidate(); }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ review */

function ReviewQueue({
  queue, loading, onVerdict, pendingId,
}: {
  queue: QueueItem[];
  loading: boolean;
  onVerdict: (resultId: number, verdict: Verdict) => void;
  pendingId: number | null;
}) {
  if (loading) return <Loading />;
  if (queue.length === 0) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="Nothing waiting on you"
        body="Results land here when a suite's supervision policy queues them — by default, the ones the graders were least sure about."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Your verdict overrides the grader without erasing it: the grader's answer is
        kept so agreement stays measurable.
      </p>
      {queue.map((item) => {
        const hasNoAnswer = item.status === 'error' || item.status === 'skipped';
        return (
        <div key={item.id} className="rounded-lg border border-border/60 bg-card p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{item.case_name || 'Untitled case'}</div>
              <div className="text-xs text-muted-foreground mt-0.5 truncate">
                {item.suite_name}
                {item.review_reason && <> · queued because: {item.review_reason}</>}
              </div>
            </div>
            {hasNoAnswer ? (
              <span className="px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap bg-red-500/10 text-red-600 dark:text-red-400">
                no answer
              </span>
            ) : (
              <span className={cn(
                'px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap',
                item.auto_passed === null ? 'bg-muted text-muted-foreground'
                  : item.auto_passed ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-red-500/10 text-red-600 dark:text-red-400',
              )}>
                grader: {item.auto_passed === null ? 'no opinion' : item.auto_passed ? 'pass' : 'fail'}
              </span>
            )}
          </div>

          {item.goal && (
            <Field label="Goal"><span className="text-muted-foreground">{item.goal}</span></Field>
          )}
          {hasNoAnswer ? (
            <Field label={item.status === 'error' ? 'Run error' : 'Skipped'}>
              <div className="text-sm text-muted-foreground">{item.error_message || 'The agent did not produce an answer.'}</div>
              <p className="text-xs text-muted-foreground mt-2">
                Dismiss this result to remove it from the review queue; it cannot be scored as a human verdict.
              </p>
            </Field>
          ) : (
            <Field label="Answer">
              {/* Agent answer — model-written markdown, not preformatted text. */}
              <div className="text-sm leading-relaxed">
                <MarkdownMessage content={item.answer || '(empty)'} variant="compact" />
              </div>
              {item.answer_truncated && (
                <span className="text-[11px] text-muted-foreground">(truncated)</span>
              )}
            </Field>
          )}

          <div className="flex items-center gap-2 mt-4">
            {hasNoAnswer ? (
              <button
                onClick={() => onVerdict(item.id, 'unsure')}
                disabled={pendingId === item.id}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-500/20 transition disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" /> Dismiss result
              </button>
            ) : (
              <>
                <button
                  onClick={() => onVerdict(item.id, 'pass')}
                  disabled={pendingId === item.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 transition disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" /> Pass
                </button>
                <button
                  onClick={() => onVerdict(item.id, 'fail')}
                  disabled={pendingId === item.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-500/20 transition disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" /> Fail
                </button>
                {/* A real third answer. Forcing a coin-flip when the reviewer
                    cannot tell would corrupt `grader_agreement`, which is the one
                    number this whole feature exists to produce. */}
                <button
                  onClick={() => onVerdict(item.id, 'unsure')}
                  disabled={pendingId === item.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-medium hover:bg-muted/70 transition disabled:opacity-50"
                >
                  <HelpCircle className="w-3.5 h-3.5" /> Unsure
                </button>
              </>
            )}
            {item.execution_id && (
              <a
                href={`/runs?execution=${item.execution_id}`}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                Full trace <ChevronRight className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ suites */

function SuiteList({
  suites, loading, agents, openSuite, onToggle, onRun, runningId, onDelete, onCreate,
}: {
  suites: EvalSuite[];
  loading: boolean;
  agents: Array<{ id: number; name: string }>;
  openSuite: number | null;
  onToggle: (id: number) => void;
  onRun: (suiteId: number, agentId?: number) => void;
  runningId: number | null;
  onDelete: (id: number) => void;
  onCreate: () => void;
}) {
  if (loading) return <Loading />;
  if (suites.length === 0) {
    return (
      <EmptyState
        icon={FlaskConical}
        title="No suites yet"
        body="A suite is a set of cases — a goal and what a good answer looks like — run against one agent."
        action={<Button size="md" onClick={onCreate}>Create a suite</Button>}
      />
    );
  }

  return (
    <div className="space-y-3">
      {suites.map((suite) => (
        <SuiteRow
          key={suite.id}
          suite={suite}
          agents={agents}
          openSuite={openSuite}
          onToggle={onToggle}
          onRun={onRun}
          runningId={runningId}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function SuiteRow({ suite, agents, openSuite, onToggle, onRun, runningId, onDelete }: {
  suite: EvalSuite;
  agents: Array<{ id: number; name: string }>;
  openSuite: number | null;
  onToggle: (id: number) => void;
  onRun: (suiteId: number, agentId?: number) => void;
  runningId: number | null;
  onDelete: (id: number) => void;
}) {
  // The suite may name no agent ("Choose when running") — the old Run button
  // then fired with `undefined` and the backend answered 400, with no picker
  // anywhere to fix it. The row owns the pick: suite default first, else the
  // user's choice here, and Run stays disabled until one exists.
  const [agentPick, setAgentPick] = useState<string>('');
  const effectiveAgent = agentPick !== '' ? Number(agentPick) : (suite.subagent ?? undefined);
  const canRun = suite.case_count > 0 && effectiveAgent !== undefined && runningId !== suite.id;

  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
      <div className="p-4 flex items-center justify-between gap-4 flex-wrap">
        <button onClick={() => onToggle(suite.id)} className="flex items-center gap-3 min-w-0 text-left flex-1">
          <ChevronRight className={cn('w-4 h-4 text-muted-foreground transition', openSuite === suite.id && 'rotate-90')} />
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{suite.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {suite.case_count} case{suite.case_count === 1 ? '' : 's'}
              {' · '}pass at {Math.round(suite.pass_threshold * 100)}%
              {' · '}review: {suite.supervision}
            </div>
          </div>
        </button>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {suite.last_run && <ScoreCell run={{ ...suite.last_run, pending_review_count: suite.last_run.pending_review }} />}
          <select
            value={agentPick !== '' ? agentPick : (suite.subagent != null ? String(suite.subagent) : '')}
            onChange={(e) => setAgentPick(e.target.value)}
            title="Which agent should this suite run against?"
            className="max-w-44 truncate border border-border rounded-lg px-2 py-1.5 text-xs bg-background"
          >
            <option value="">Pick an agent…</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button
            onClick={() => effectiveAgent !== undefined && onRun(suite.id, effectiveAgent)}
            disabled={!canRun}
            title={
              suite.case_count === 0
                ? 'This suite has no cases yet.'
                : effectiveAgent === undefined
                  ? 'Pick an agent first — this suite names none.'
                  : `Run every case against ${agents.find((a) => a.id === effectiveAgent)?.name ?? 'the agent'}`
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition disabled:opacity-40"
          >
            {runningId === suite.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Run
          </button>
          <button
            onClick={() => onDelete(suite.id)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition"
            title="Delete suite"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {openSuite === suite.id && (
        <SuiteCases suiteId={suite.id} agents={agents} subagent={suite.subagent} />
      )}
    </div>
  );
}

function SuiteCases({ suiteId, agents, subagent }: {
  suiteId: number;
  agents: Array<{ id: number; name: string }>;
  subagent: number | null;
}) {
  const detail = useQuery({
    queryKey: ['eval', 'suite', suiteId],
    queryFn: () => evalsService.getSuite(suiteId),
  });
  const world = useQuery({
    queryKey: ['eval', 'world', suiteId],
    queryFn: () => evalsService.getWorld(suiteId),
  });

  const qc = useQueryClient();
  const gated = useMutation({
    mutationFn: (value: GatedCalls) => evalsService.updateSuite(suiteId, { gated_calls: value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['eval', 'suite', suiteId] }),
    onError: () => toast.error('Could not save that setting.'),
  });
  const agentName = agents.find((a) => a.id === subagent)?.name;
  const [editing, setEditing] = useState<EvalCase | 'new' | null>(null);

  if (detail.isLoading) return <div className="px-4 pb-4"><Loading /></div>;
  const all = detail.data?.cases ?? [];
  const drafts = all.filter(isDraft);
  const cases = all.filter((c) => !isDraft(c));
  const liveVersion = world.data?.live?.version ?? null;

  return (
    <div className="border-t border-border/60 bg-muted/20 px-4 py-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {agentName ? <>Runs against <span className="font-medium text-foreground">{agentName}</span></> : 'No agent set — pick one to generate cases.'}
        </span>
        {/* An eval never waits for a person; this decides what happens to a
            call that would have. Either way it is recorded on the result. */}
        <label className="flex items-center gap-1.5">
          Calls needing approval:
          <select
            className="rounded border border-border bg-card px-1.5 py-1 text-xs text-foreground"
            value={detail.data?.gated_calls ?? 'run'}
            disabled={gated.isPending}
            onChange={(e) => gated.mutate(e.target.value as GatedCalls)}
          >
            <option value="run">Record and run</option>
            <option value="block">Record and block</option>
          </select>
        </label>
      </div>
      <WorldCard suiteId={suiteId} hasAgent={subagent != null} />
      <DraftCases suiteId={suiteId} hasAgent={subagent != null} drafts={drafts} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{cases.length} case{cases.length === 1 ? '' : 's'}</span>
        <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
          <Plus className="w-3.5 h-3.5" /> Write a case
        </Button>
      </div>
      {cases.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          No cases yet. Generate some from the agent's setup, import its recent runs, or write your own.
        </p>
      ) : (
        <div className="space-y-1.5">
          {cases.map((c) => (
            <CaseRow key={c.id} caseData={c} liveVersion={liveVersion} onEdit={() => setEditing(c)} />
          ))}
        </div>
      )}
      {editing && (
        <CaseEditor
          suiteId={suiteId}
          existing={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** One accepted case: goal on the row, expected answer and facts on expand. */
function CaseRow({ caseData: c, liveVersion, onEdit }: {
  caseData: EvalCase;
  liveVersion: number | null;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const facts = Array.isArray((c.input_data ?? {})['__facts__'])
    ? (c.input_data['__facts__'] as unknown[]).map(String)
    : [];
  const stale = c.world_version !== null && liveVersion !== null && c.world_version !== liveVersion;
  return (
    <div className="py-1.5 text-xs">
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-medium truncate">{c.name || `Case ${c.id}`}</span>
              {c.world_version !== null && c.world_version !== undefined && (
                <span className={cn(
                  'shrink-0 rounded px-1 py-px text-[10px] font-medium',
                  stale ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-muted text-muted-foreground',
                )} title={stale ? 'Built for an older world version — kept, listed, never swept' : 'The world version this case was built for'}>
                  {stale ? `stale (world v${c.world_version})` : `world v${c.world_version}`}
                </span>
              )}
            </div>
            <div className={cn('text-muted-foreground mt-0.5', !open && 'truncate')}>{c.goal}</div>
          </div>
          <span className="text-muted-foreground whitespace-nowrap shrink-0">
            {c.graders.length} grader{c.graders.length === 1 ? '' : 's'}
            {!c.is_active && ' · inactive'}
          </span>
        </div>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 text-muted-foreground">
          {c.reference && <div><span className="text-foreground">Expected answer:</span> {c.reference}</div>}
          {facts.length > 0 && <div><span className="text-foreground">Rests on facts:</span> {facts.join(', ')}</div>}
          <div>
            <span className="text-foreground">Checks:</span>{' '}
            {c.graders.map((g) => g.type).join(', ') || 'none — queued for review under every policy'}
          </div>
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Pencil className="w-3.5 h-3.5" /> Edit
          </Button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- runs */

function RunList({ runs, loading, openRun, onToggle, onDelete, deletingId }: {
  runs: EvalRun[];
  loading: boolean;
  openRun: string | null;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  deletingId: string | null;
}) {
  if (loading) return <Loading />;
  if (runs.length === 0) {
    return <EmptyState icon={Activity} title="No sweeps yet" body="Run a suite and its history shows up here." />;
  }

  return (
    <div className="space-y-2">
      {runs.map((run) => {
        const canDelete = !['pending', 'queued', 'running'].includes(run.status)
          && !(run.status === 'cancelled' && !run.completed_at);
        return (
          <div key={run.run_id} className="rounded-lg border border-border/60 bg-card overflow-hidden">
            <div className="flex items-center gap-2 pr-3">
              <button
                onClick={() => onToggle(run.run_id)}
                className="min-w-0 flex-1 p-4 flex items-center justify-between gap-4 text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <ChevronRight className={cn('w-4 h-4 text-muted-foreground transition', openRun === run.run_id && 'rotate-90')} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{run.suite_name || 'Suite'}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {run.agent_name || 'agent'}
                      {run.revision_number !== null && ` · rev ${run.revision_number}`}
                      {' · '}{run.total_cases} case{run.total_cases === 1 ? '' : 's'}
                      {new Date(run.created_at).toString() !== 'Invalid Date' && ` · ${new Date(run.created_at).toLocaleString()}`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {run.grader_agreement !== null && (
                    <span className="text-[11px] text-muted-foreground" title="How often a reviewer agreed with the graders.">
                      {Math.round(run.grader_agreement * 100)}% agreement
                    </span>
                  )}
                  <ScoreCell run={run} />
                  <StatusPill status={run.status} />
                </div>
              </button>
              {canDelete && (
                <button
                  onClick={() => onDelete(run.run_id)}
                  disabled={deletingId === run.run_id}
                  aria-label={`Delete eval sweep ${run.suite_name || run.run_id}`}
                  title="Delete this sweep and its evaluation traces"
                  className="shrink-0 p-2 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition disabled:opacity-50"
                >
                  {deletingId === run.run_id
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Trash2 className="w-4 h-4" />}
                </button>
              )}
            </div>

            {openRun === run.run_id && <RunResults runId={run.run_id} error={run.error_message} />}
          </div>
        );
      })}
    </div>
  );
}

function StarterKitsCard({ agents, onCloned }: {
  agents: Array<{ id: number; name: string }>;
  onCloned: () => void;
}) {
  const queryClient = useQueryClient();
  const [agentId, setAgentId] = useState<string>('');
  const kitsQuery = useQuery({
    queryKey: ['eval', 'starter-kits', agentId],
    queryFn: () => evalsService.starterKits(agentId ? Number(agentId) : undefined),
    staleTime: 60_000,
  });
  const clone = useMutation({
    mutationFn: (template: string) => evalsService.cloneStarter({
      template, ...(agentId ? { agent_id: Number(agentId) } : {}),
    }),
    onSuccess: (suite) => {
      toast.success(`Starter "${suite.name}" created with ${suite.cases.length} cases.`);
      queryClient.invalidateQueries({ queryKey: ['eval'] });
      onCloned();
    },
    onError: (error: unknown) => {
      const detail = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error('Could not clone the starter', { description: detail ?? 'Please try again.' });
    },
  });
  const kits = kitsQuery.data?.kits ?? [];
  const recommended = new Set(kitsQuery.data?.recommended ?? []);
  if (kitsQuery.isLoading) return null;
  if (kits.length === 0) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h3 className="text-sm font-semibold">Start from a starter dataset</h3>
        <span className="text-[11px] text-muted-foreground">Core checks plus real-world tasks · normal · ambiguous · impossible · guardrail · hallucination trap</span>
        <select
          className="ml-auto border border-border rounded px-2 py-1 text-xs bg-background"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
        >
          <option value="">No agent (generic)</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div className="grid gap-2 md:grid-cols-2 mt-2">
        {kits.map((k) => (
          <div key={k.slug} className="border border-border/60 rounded p-3 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">
                {k.name}
                {recommended.has(k.slug) && (
                  <span className="ml-2 text-[10px] uppercase tracking-wide font-semibold text-primary">Recommended</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">{k.description} · {k.case_count} cases</div>
            </div>
            <button
              onClick={() => clone.mutate(k.slug)}
              disabled={clone.isPending}
              className="shrink-0 px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
            >
              {clone.isPending && clone.variables === k.slug ? 'Cloning…' : 'Clone'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function JudgeCard({ data }: { data?: { calibrations?: Record<string, { judge_model: string; agreement: number; false_pass_rate: number; created_at: string }> } | null }) {
  const calib = data?.calibrations?.handwritten ?? data?.calibrations?.gold;
  if (!calib) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-card px-4 py-3 text-xs text-muted-foreground">
      Judge <span className="font-mono">{calib.judge_model}</span>
      {' · '}agreement {Math.round(calib.agreement * 100)}%
      {' · '}false-pass {Math.round(calib.false_pass_rate * 100)}%
      {' · '}{new Date(calib.created_at).toLocaleDateString()}
    </div>
  );
}

function QualityTab({ data, loading }: { data?: Record<string, unknown>; loading: boolean }) {
  if (loading) return <Loading />;
  if (!data) return <p className="text-sm text-muted-foreground">No quality data yet.</p>;
  const cats = (data.by_failure_category ?? {}) as Record<string, number>;
  const sigs = (data.signals_by_kind ?? {}) as Record<string, number>;
  const recent = (data.recent_thumbs_down ?? []) as Array<{ type: string; id: string | number; agent: string; reason: string; comment: string }>;
  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-lg border border-border/60 bg-card p-4">
        <h3 className="font-semibold mb-2">Thumbs</h3>
        <p className="text-muted-foreground">Up {String(data.thumbs_up ?? 0)} · Down {String(data.thumbs_down ?? 0)}</p>
      </div>
      <div className="rounded-lg border border-border/60 bg-card p-4">
        <h3 className="font-semibold mb-2">Failures by category</h3>
        {Object.keys(cats).length === 0
          ? <p className="text-muted-foreground">None recorded.</p>
          : <ul className="space-y-1">{Object.entries(cats).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>}
      </div>
      <div className="rounded-lg border border-border/60 bg-card p-4">
        <h3 className="font-semibold mb-2">Signals</h3>
        {Object.keys(sigs).length === 0
          ? <p className="text-muted-foreground">None recorded.</p>
          : <ul className="space-y-1">{Object.entries(sigs).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>}
      </div>
      {recent.length > 0 && (
        <div className="rounded-lg border border-border/60 bg-card p-4">
          <h3 className="font-semibold mb-2">Recent thumbs-down</h3>
          <ul className="space-y-1 text-xs">
            {recent.map((t, i) => (
              <li key={i}>{t.type} {String(t.id)} · {t.agent} · {t.reason} · {t.comment}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** What the run changed in the eval world — the "what changed" panel. */
function ChangedList({ changes }: { changes?: Record<string, unknown> }) {
  const lines = changedLines(changes);
  if (lines.length === 0) return null;
  return (
    <div className="mt-1 text-muted-foreground">
      <span className="text-foreground">Changed:</span> {lines.join(' · ')}
    </div>
  );
}

function changedLines(changes?: Record<string, unknown>): string[] {
  if (!changes || typeof changes !== 'object') return [];
  const lines: string[] = [];
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String).filter(Boolean) : [];
  const files = strList(changes.files_written);
  if (files.length > 0) lines.push(`wrote ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` +${files.length - 3} more` : ''}`);
  const removed = strList(changes.files_removed);
  if (removed.length > 0) lines.push(`removed ${removed.slice(0, 3).join(', ')}`);
  const mail = changes.mail as Record<string, unknown> | undefined;
  if (mail && typeof mail === 'object') {
    const sent = mail.sent as Array<{ to?: string; subject?: string }> | undefined;
    if (Array.isArray(sent) && sent.length > 0) {
      lines.push(`sent ${sent.length} email${sent.length === 1 ? '' : 's'} (${sent.slice(0, 2).map((s) => s?.to ?? '').filter(Boolean).join(', ')})`);
    }
    const drafts = mail.drafts as unknown[] | undefined;
    if (Array.isArray(drafts) && drafts.length > 0) lines.push(`${drafts.length} draft${drafts.length === 1 ? '' : 's'}`);
  }
  const cal = changes.calendar as Record<string, unknown> | undefined;
  if (cal && typeof cal === 'object') {
    for (const [key, label] of [['events_created', 'created'], ['events_updated', 'updated'], ['events_deleted', 'deleted']] as const) {
      const items = cal[key] as unknown[] | undefined;
      if (Array.isArray(items) && items.length > 0) lines.push(`${label} ${items.length} event${items.length === 1 ? '' : 's'}`);
    }
  }
  const drive = changes.drive as Record<string, unknown> | undefined;
  if (drive && typeof drive === 'object') {
    const cells = drive.cells_updated as unknown[] | undefined;
    if (Array.isArray(cells) && cells.length > 0) lines.push(`updated ${cells.length} sheet range${cells.length === 1 ? '' : 's'}`);
    const created = drive.files_created as unknown[] | undefined;
    if (Array.isArray(created) && created.length > 0) lines.push(`created ${created.length} drive file${created.length === 1 ? '' : 's'}`);
  }
  const web = changes.web as Record<string, unknown> | undefined;
  if (web && typeof web === 'object') {
    const searches = web.searches as unknown[] | undefined;
    const reads = web.reads as unknown[] | undefined;
    const bits = [
      Array.isArray(searches) && searches.length > 0 ? `${searches.length} search${searches.length === 1 ? '' : 'es'}` : '',
      Array.isArray(reads) && reads.length > 0 ? `${reads.length} read${reads.length === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    if (bits.length > 0) lines.push(`web: ${bits.join(', ')}`);
  }
  return lines;
}

function RunResults({ runId, error }: { runId: string; error?: string }) {  const detail = useQuery({
    queryKey: ['eval', 'run', runId],
    queryFn: () => evalsService.getRun(runId),
  });

  if (detail.isLoading) return <div className="px-4 pb-4"><Loading /></div>;
  const results = detail.data?.results ?? [];

  return (
    <div className="border-t border-border/60 bg-muted/20 px-4 py-3 space-y-2">
      {error && (
        <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {results.length === 0 && <p className="text-xs text-muted-foreground py-1">No results recorded.</p>}
      {results.map((r) => (
        <div key={r.id} className="flex items-start justify-between gap-3 py-1.5 text-xs border-b border-border/40 last:border-0">
          <div className="min-w-0">
            <div className="font-medium truncate">{r.case_name || `Case ${r.case ?? r.id}`}</div>
            {r.error_message
              ? <div className="text-red-600 dark:text-red-400 truncate">{r.error_message}</div>
              : <div className="text-muted-foreground truncate">{r.answer || '(no answer)'}</div>}
            <IntentList intents={r.intents} />
            <ChangedList changes={r.env_changes} />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* auto vs final: showing both is the point of the review model. */}
            {r.review && r.auto_passed !== r.final_passed && (
              <span className="text-[11px] text-muted-foreground line-through">
                {r.auto_passed ? 'pass' : 'fail'}
              </span>
            )}
            <span className={cn(
              'px-2 py-0.5 rounded text-[11px] font-medium',
              r.final_passed === null ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                : r.final_passed ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-red-500/10 text-red-600 dark:text-red-400',
            )}>
              {r.final_passed === null ? 'awaiting review' : r.final_passed ? 'pass' : 'fail'}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ create */

function CreateSuiteModal({ agents, onClose, onCreated }: {
  agents: Array<{ id: number; name: string }>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [subagent, setSubagent] = useState<number | ''>(agents[0]?.id ?? '');
  const [supervision, setSupervision] = useState<SupervisionPolicy>('disagreement');
  const [samplePercent, setSamplePercent] = useState(20);
  const [threshold, setThreshold] = useState(0.8);

  const create = useMutation({
    mutationFn: () => evalsService.createSuite({
      name: name.trim(),
      description: description.trim(),
      subagent: subagent === '' ? null : Number(subagent),
      supervision,
      sample_percent: samplePercent,
      pass_threshold: threshold,
    }),
    onSuccess: () => { toast.success('Suite created'); onCreated(); },
    onError: (error: unknown) => {
      const data = (error as { response?: { data?: Record<string, string[] | string> } })?.response?.data;
      const first = data && Object.entries(data)[0];
      toast.error('Could not create the suite', {
        description: first ? `${first[0]}: ${String(first[1])}` : undefined,
      });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-card border border-border/60 shadow-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
          <h2 className="text-base font-semibold">New eval suite</h2>
          <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <label className="block">
            <span className="text-xs font-medium">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Refund policy answers"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium">Agent</span>
            <select
              value={subagent}
              onChange={(e) => setSubagent(e.target.value === '' ? '' : Number(e.target.value))}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            >
              <option value="">Choose when running</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium">What gets reviewed by a human</span>
            <select
              value={supervision}
              onChange={(e) => setSupervision(e.target.value as SupervisionPolicy)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            >
              {(Object.keys(SUPERVISION_HELP) as SupervisionPolicy[]).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] text-muted-foreground">{SUPERVISION_HELP[supervision]}</span>
          </label>

          {supervision === 'sampled' && (
            <label className="block">
              <span className="text-xs font-medium">Sample percent</span>
              <input
                type="number" min={0} max={100}
                value={samplePercent}
                onChange={(e) => setSamplePercent(Number(e.target.value))}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
            </label>
          )}

          <label className="block">
            <span className="text-xs font-medium">Passes at {Math.round(threshold * 100)}% of cases</span>
            <input
              type="range" min={0} max={1} step={0.05}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="mt-2 w-full"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border/60">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button
            onClick={() => create.mutate()}
            disabled={!name.trim() || create.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {create.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Create
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ shared */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <div className="text-[11px] font-medium text-muted-foreground mb-0.5">{label}</div>
      <div className="text-xs bg-muted/40 rounded-lg px-3 py-2 max-h-40 overflow-auto">{children}</div>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-12 text-muted-foreground">
      <Loader2 className="w-5 h-5 animate-spin" />
    </div>
  );
}
