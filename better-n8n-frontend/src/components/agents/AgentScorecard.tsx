/**
 * How this agent scores, on the screen where it is changed.
 *
 * `GET /eval/agents/{id}/scorecard/` was built for exactly the "should I ship
 * this change?" question and had no caller: the score lived on Evals, the
 * change lived here, and the revision tying them together was visible on
 * neither. Each suite shows its latest *settled* score and the revision it was
 * scored under, so "rev 7 scored 0.62, you are on rev 9" is readable before
 * deciding whether to run it again. A run still awaiting human review is
 * counted, never shown as the score — a provisional number presented as the
 * current one is how an unreviewed sweep becomes a release decision.
 */
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import evalsService from '../../api/evals';

interface ScorePoint {
  run_id: string;
  score: number | null;
  passed: boolean | null;
  status: string;
  revision: number | null;
}

interface SuiteScore {
  suite_id: number;
  suite_name: string;
  latest: ScorePoint | null;
  awaiting_review: number;
  history: ScorePoint[];
}

interface Scorecard {
  suites: SuiteScore[];
}

function pct(score: number | null): string {
  return score == null ? '—' : `${Math.round(score * 100)}%`;
}

export default function AgentScorecard({ agentId, currentRevision }: {
  agentId: number;
  /** The newest revision number, so a stale score can say it is stale. */
  currentRevision: number | null;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['agent-scorecard', agentId],
    queryFn: async () => (await evalsService.scorecard(agentId)) as Scorecard,
  });

  const run = useMutation({
    mutationFn: (suiteId: number) => evalsService.runSuite(suiteId, { agent_id: agentId }),
    onSuccess: () => {
      toast.success('Evaluation started — results appear here and on Evals.');
      queryClient.invalidateQueries({ queryKey: ['agent-scorecard', agentId] });
    },
    onError: (err: { response?: { data?: { error?: string } } }) =>
      toast.error(err.response?.data?.error ?? 'Could not start the evaluation.'),
  });

  if (isLoading) {
    return <p className="text-[12px] text-muted-foreground">Loading scores…</p>;
  }
  const suites = data?.suites ?? [];
  if (suites.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground">
        No test suite has been run against this agent yet.{' '}
        <Link to="/evals" className="text-primary hover:underline">Create one on Evals</Link>{' '}
        to check a change before you rely on it.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {suites.map((suite) => {
        const latest = suite.latest;
        const stale = latest?.revision != null && currentRevision != null
          && latest.revision < currentRevision;
        return (
          <li key={suite.suite_id} className="flex items-center gap-3 text-[12px]">
            <span className="font-medium truncate flex-1">{suite.suite_name}</span>
            <span className={latest?.passed === false ? 'text-destructive' : 'text-foreground'}
              title={latest ? `Scored under v${latest.revision ?? '?'}` : 'No settled score yet'}>
              {pct(latest?.score ?? null)}
            </span>
            <span className="text-muted-foreground w-28 text-right">
              {latest?.revision != null ? `v${latest.revision}` : 'not scored'}
              {stale && ' · older config'}
            </span>
            {suite.awaiting_review > 0 && (
              <Link to="/evals" className="text-warning hover:underline">
                {suite.awaiting_review} to review
              </Link>
            )}
            <button type="button" onClick={() => run.mutate(suite.suite_id)}
              disabled={run.isPending}
              className="px-2 h-6 rounded border border-border hover:bg-secondary disabled:opacity-50">
              Run
            </button>
          </li>
        );
      })}
    </ul>
  );
}
