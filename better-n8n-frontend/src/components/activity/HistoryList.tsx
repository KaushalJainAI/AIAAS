/**
 * History — finished (and finishing) runs with Delete per row and bulk
 * clearing.
 *
 * Moved from `pages/Runs.tsx` during the Activity split, plus deletion: the
 * backend had no delete route, so crashed runs and test noise stayed for
 * ever. A live run cannot be deleted until it is stopped (the server 409s),
 * eval-caller runs are deleted via their sweep, and cost rows are kept so
 * spend totals don't drop. Destructive actions use the in-app ConfirmDialog,
 * never `window.confirm`.
 */
import { useState } from 'react';
import { usePersistedState } from '../../hooks/usePersistedState';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { GitBranch, Loader2, Target, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  logsService,
  type ExecutionLog,
} from '../../api';
import { cn } from '../../lib/utils';
import { describeCost, formatCost } from '../../lib/cost';
import FilePreviewProvider from '../files/FilePreviewProvider';
import RunControls from '../runs/RunControls';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useLiveRun } from '../../hooks/useLiveRun';
import RunDetail from './RunDetail';
import { StatusPill, when } from './bits';

/** Statuses whose detail can still change, so an open run keeps refreshing. */
const LIVE_STATUSES = new Set(['running', 'pending', 'paused']);

// `paused` is the one that needs someone: a run waiting on an approval.
const FILTERS = ['all', 'running', 'paused', 'completed', 'failed'] as const;

const FILTER_LABELS: Record<(typeof FILTERS)[number], string> = {
  all: 'All runs', running: 'Running', paused: 'Needs you',
  completed: 'Completed', failed: 'Failed',
};

/** What started a run. `trigger_type` says how it arrived; this says who asked.
 *  A delegated worker and a direct API call both arrive as `api`, and telling
 *  them apart is the difference between "you asked for this" and "an agent
 *  decided to spend your credits on it". */
const CALLER_LABELS: Record<string, string> = {
  api: 'API',
  chat: 'Chat',
  orchestrator: 'By another agent',
  trigger: 'Trigger',
  eval: 'Evaluation',
  mission: 'Mission',
};

function errorText(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { error?: string } } }).response?.data;
  return data?.error ?? fallback;
}

export default function HistoryList({ pendingCount }: { pendingCount: number }) {
  const [filter, setFilter] = usePersistedState<(typeof FILTERS)[number]>('runs.filter', 'all', {
    validate: (v): v is (typeof FILTERS)[number] => FILTERS.includes(v as never),
  });
  const [showEval, setShowEval] = usePersistedState<boolean>('runs.showEval', false);
  const queryClient = useQueryClient();
  // The open run lives in the URL (`?run=<id>`), so a run can be linked to.
  // "Open that run" on a delegated run and the builder's Run button both link
  // here. The selected approval lives in `?request=` (owned by NeedsYou).
  const [params, setParams] = useSearchParams();
  const openId = params.get('run');
  const setOpenId = (id: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('run', id);
      else next.delete('run');
      return next;
    }, { replace: true });
  };

  // One agent's runs, from `?agent=<id>` — the builder and Insights link here
  // with it. `?status=` / `?failure_category=` arrive the same way from the
  // Insights "What to fix" card, so a linked failure list opens filtered
  // rather than as "All runs" the user must re-filter by eye.
  const agentFilter = Number(params.get('agent')) || null;
  const urlStatus = params.get('status');
  const urlFailure = params.get('failure_category');
  const effectiveFilter = (FILTERS as readonly string[]).includes(urlStatus ?? '')
    ? (urlStatus as (typeof FILTERS)[number])
    : filter;
  const { data, isLoading } = useQuery({
    queryKey: ['runs', effectiveFilter, agentFilter, urlFailure, showEval],
    queryFn: () => logsService.listExecutions({
      limit: 50,
      ...(effectiveFilter === 'all' ? {} : { status: effectiveFilter }),
      ...(agentFilter ? { workflow_id: agentFilter } : {}),
      ...(urlFailure ? { failure_category: urlFailure } : {}),
      ...(showEval ? { caller: 'eval' } : {}),
    }),
    // Only poll while something can still change. A finished list is finished:
    // new runs arrive from a user action or a schedule, and window focus
    // revalidates on return, so an idle tab does not need a timer at all.
    refetchInterval: (q) =>
      (q.state.data?.results ?? []).some((r) => r.status === 'running' || r.status === 'pending')
        ? 10_000
        : false,
  });
  const runs: ExecutionLog[] = data?.results ?? [];

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['run', openId],
    enabled: !!openId,
    queryFn: () => logsService.getExecution(openId!),
    // A run opened from the Run button is seconds old; without this its
    // detail was a snapshot of the first step and never moved.
    // With the socket up, frames drive refreshes (`useLiveRun`) and this is
    // only a slow safety net; without it, this is how the run stays current.
    refetchInterval: (q) =>
      LIVE_STATUSES.has(q.state.data?.status ?? '') ? (liveSocket ? 30_000 : 5_000) : false,
  });
  const { isConnected: liveSocket } = useLiveRun(
    openId, LIVE_STATUSES.has(detail?.status ?? ''),
  );
  // A linked run the current filter hides (or that is older than the list's
  // 50) still has to be shown, or following a link opens nothing.
  const linkedRunHidden = !!openId && !isLoading
    && !runs.some((r) => r.execution_id === openId);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['runs'] });
    queryClient.invalidateQueries({ queryKey: ['run'] });
    queryClient.invalidateQueries({ queryKey: ['activity', 'live'] });
  };

  const [deleting, setDeleting] = useState<ExecutionLog | null>(null);
  const [clearingFailed, setClearingFailed] = useState(false);
  const [clearingOld, setClearingOld] = useState(false);
  const [olderDays, setOlderDays] = useState('30');

  const deleteOne = useMutation({
    mutationFn: (run: ExecutionLog) => logsService.deleteExecution(run.execution_id),
    onSuccess: (_d, run) => {
      toast.success('Run deleted. Cost records were kept.');
      if (openId === run.execution_id) setOpenId(null);
      setDeleting(null);
      refresh();
    },
    onError: (err) => {
      toast.error(errorText(err, 'Could not delete that run.'));
      setDeleting(null);
    },
  });

  const clearFailed = useMutation({
    mutationFn: () => logsService.bulkDeleteExecutions({ status: 'failed' }),
    onSuccess: (result) => {
      toast.success(result.deleted === 0 ? 'No failed runs to clear.' : `Cleared ${result.deleted} failed run(s). Cost records were kept.`);
      setClearingFailed(false);
      refresh();
    },
    onError: (err) => {
      toast.error(errorText(err, 'Could not clear failed runs.'));
      setClearingFailed(false);
    },
  });

  const clearOld = useMutation({
    mutationFn: async (days: number) => {
      // One status per call — the endpoint takes a single terminal state.
      let deleted = 0;
      for (const status of ['failed', 'cancelled', 'timeout'] as const) {
        const result = await logsService.bulkDeleteExecutions({ status, older_than_days: days });
        deleted += result.deleted;
      }
      return { deleted };
    },
    onSuccess: (result) => {
      toast.success(result.deleted === 0 ? 'Nothing that old to clear.' : `Cleared ${result.deleted} old run(s). Cost records were kept.`);
      setClearingOld(false);
      refresh();
    },
    onError: (err) => {
      toast.error(errorText(err, 'Could not clear old runs.'));
      setClearingOld(false);
    },
  });

  return (
    <FilePreviewProvider>
      <div className="flex gap-2 items-center flex-wrap mb-3">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1.5 text-sm rounded border transition-colors first-letter:uppercase',
              filter === f
                ? 'bg-primary text-primary-foreground border-primary font-semibold'
                : 'bg-card border-border hover:bg-secondary'
            )}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
        <label className="ml-2 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showEval}
            onChange={(e) => setShowEval(e.target.checked)}
            className="accent-current"
          />
          Show evaluation runs
        </label>
        {agentFilter && (
          <button
            onClick={() => setParams((prev) => {
              const next = new URLSearchParams(prev);
              next.delete('agent');
              return next;
            }, { replace: true })}
            title="Show every agent's runs"
            className="px-3 py-1.5 text-sm rounded border border-primary text-primary bg-primary/10"
          >
            {runs[0]?.workflow_name ?? 'One agent'} ×
          </button>
        )}
        {urlFailure && (
          <button
            onClick={() => setParams((prev) => {
              const next = new URLSearchParams(prev);
              next.delete('failure_category');
              return next;
            }, { replace: true })}
            title="Clear failure filter"
            className="px-3 py-1.5 text-sm rounded border border-primary text-primary bg-primary/10"
          >
            {urlFailure.replace('_', ' ')} ×
          </button>
        )}
        {urlStatus && (FILTERS as readonly string[]).includes(urlStatus) && urlStatus !== filter && (
          <button
            onClick={() => {
              setFilter(urlStatus as (typeof FILTERS)[number]);
              setParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete('status');
                return next;
              }, { replace: true });
            }}
            title="Apply linked status as filter"
            className="px-3 py-1.5 text-sm rounded border border-primary text-primary bg-primary/10"
          >
            {urlStatus} ×
          </button>
        )}
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setClearingFailed(true)}
            className="px-3 py-1.5 text-[12px] rounded border border-border hover:bg-secondary text-muted-foreground"
            title="Delete every failed run. Cost records are kept."
          >
            Clear failed
          </button>
          <label className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
            Clear older than
            <input
              value={olderDays}
              onChange={(e) => setOlderDays(e.target.value)}
              inputMode="numeric"
              aria-label="Older than, in days"
              className="w-14 px-2 py-1.5 bg-card border border-border rounded text-[12px] tabular-nums"
            />
            days
          </label>
          <button
            type="button"
            onClick={() => setClearingOld(true)}
            disabled={!/^\d+$/.test(olderDays.trim())}
            className="px-3 py-1.5 text-[12px] rounded border border-border hover:bg-secondary text-muted-foreground disabled:opacity-50"
            title="Delete failed, cancelled and timed-out runs older than N days. Cost records are kept."
          >
            Clear
          </button>
        </span>
      </div>

      {linkedRunHidden && (
        <div className="mb-4 border border-primary/40 rounded bg-card">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <span className="font-medium text-sm flex-1 truncate">
              {detail?.workflow_name ?? 'Linked run'}
            </span>
            {detail && <StatusPill status={detail.status} />}
            <button onClick={() => setOpenId(null)}
              className="text-[12px] text-muted-foreground hover:text-foreground">
              Close
            </button>
          </div>
          <div className="px-4 py-4 bg-bg-1">
            {detailLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : detail ? (
              <>
                {detail.error_message && (
                  <div className="mb-3 px-3 py-2 rounded bg-destructive-subtle border border-red-200 text-[13px] text-destructive">
                    {detail.error_message}
                  </div>
                )}
                <>
                {LIVE_STATUSES.has(detail.status) && (
                  <RunControls executionId={detail.execution_id}
                    agentId={detail.workflow_id ?? null} status={detail.status} />
                )}
                <RunDetail detail={detail} />
              </>
              </>
            ) : (
              <p className="text-[13px] text-muted-foreground">That run could not be found.</p>
            )}
          </div>
        </div>
      )}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : runs.length === 0 ? (
        <div className="text-center py-20">
          <h3 className="text-lg font-semibold mb-1">
            {pendingCount > 0 ? 'No runs yet' : 'No activity yet'}
          </h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {pendingCount > 0
              ? 'Runs appear here as soon as they start, whether you started them or a schedule did.'
              : 'Once your agents run, they appear here — and when one reaches a step it isn\u2019t allowed to take on its own, it stops and asks at the top of this page.'}
          </p>
        </div>
      ) : (
        <div className="border border-border rounded overflow-hidden bg-card">
          {runs.map((run) => {
            const open = openId === run.execution_id;
            return (
              <div key={run.execution_id} className="border-b border-border last:border-b-0">
                <button
                  onClick={() => setOpenId(open ? null : run.execution_id)}
                  className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-secondary transition-colors"
                >
                  <span className="font-medium text-sm flex-1 truncate">{run.workflow_name ?? 'Deleted agent'}</span>
                  {run.is_delegated && (
                    <GitBranch className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-label="Started by another agent" />
                  )}
                  {run.mission_id != null && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-primary-line bg-primary-subtle text-primary text-[11px] font-semibold shrink-0" title={`Part of mission #${run.mission_id}`}>
                      <Target className="w-3 h-3" />#{run.mission_id}
                    </span>
                  )}
                  <StatusPill status={run.status} />
                  <span className="text-[12px] text-muted-foreground w-24 text-right">{CALLER_LABELS[run.caller] ?? run.trigger_type}</span>
                  <span
                    className={cn(
                      'text-[12px] w-20 text-right tabular-nums',
                      run.cost_source === 'unpriced'
                        ? 'text-muted-foreground/50'
                        : 'text-muted-foreground',
                    )}
                    title={describeCost(run.cost_usd, run.cost_source, run)}
                  >
                    {formatCost(run.cost_usd, run.cost_source)}
                  </span>
                    <span className="text-[12px] text-muted-foreground w-16 text-right tabular-nums">{run.duration_ms != null ? (run.duration_ms < 1000 ? `${run.duration_ms}ms` : `${(run.duration_ms / 1000).toFixed(1)}s`) : '—'}</span>
                    <span className="text-[12px] text-muted-foreground w-20 text-right">{when(run.created_at)}</span>
                  </button>

                {open && (
                  <div className="px-4 pb-4 pl-12 bg-bg-1">
                    {run.error_message && (
                      <div className="mb-3 px-3 py-2 rounded bg-destructive-subtle border border-red-200 text-[13px] text-destructive">
                        {run.error_message}
                      </div>
                    )}
                    {detailLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    ) : detail ? (
                      <>
                        {LIVE_STATUSES.has(detail.status) && (
                          <RunControls executionId={detail.execution_id}
                            agentId={detail.workflow_id ?? null} status={detail.status} />
                        )}
                        <div className="flex items-center gap-2 mt-3">
                          {!LIVE_STATUSES.has(detail.status) && detail.caller !== 'eval' && (
                            <button
                              type="button"
                              onClick={() => setDeleting(run)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded border border-border hover:bg-secondary text-muted-foreground"
                              title="Delete this run and its trace. Cost records are kept."
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete run
                            </button>
                          )}
                          {detail.caller === 'eval' && (
                            <span className="text-[11px] text-muted-foreground">
                              Evaluation runs are deleted with their sweep on the Evals page.
                            </span>
                          )}
                        </div>
                        <RunDetail detail={detail} />
                      </>
                    ) : (
                      <p className="text-[13px] text-muted-foreground">No details recorded for this run.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete this run?"
          body={`"${deleting.workflow_name ?? 'Deleted agent'}" and its trace go away. Cost records are kept so spend totals don't drop. This cannot be undone.`}
          confirmLabel="Delete run"
          busy={deleteOne.isPending}
          onConfirm={() => deleteOne.mutate(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}

      {clearingFailed && (
        <ConfirmDialog
          title="Clear failed runs?"
          body="Every failed run and its trace goes away. Cost records are kept so spend totals don't drop. This cannot be undone."
          confirmLabel="Clear failed"
          busy={clearFailed.isPending}
          onConfirm={() => clearFailed.mutate()}
          onCancel={() => setClearingFailed(false)}
        />
      )}

      {clearingOld && (
        <ConfirmDialog
          title={`Clear runs older than ${olderDays.trim()} days?`}
          body="Failed, cancelled and timed-out runs older than that go away. Cost records are kept so spend totals don't drop. This cannot be undone."
          confirmLabel="Clear old runs"
          busy={clearOld.isPending}
          onConfirm={() => clearOld.mutate(Number(olderDays.trim()))}
          onCancel={() => setClearingOld(false)}
        />
      )}
    </FilePreviewProvider>
  );
}
