/**
 * Agent history — the whole configuration timeline, on its own page.
 *
 * It used to live inline in the builder, under the knobs. That works for an
 * agent saved twice and fails for one that is actually being tuned: the list
 * grows for the life of the agent, so the section below it drifted further off
 * the screen with every save, and the backend answered with a single capped
 * list so everything past the cap was simply unreachable.
 *
 * So the builder keeps the newest few — enough to answer "what did I just
 * change?" without leaving the board — and this page walks the rest a page at
 * a time. The point is still correlation, not nostalgia: a run records the
 * revision it executed under, so "it got worse on Tuesday" becomes "it got
 * worse at v4, which changed the model and the autonomy", and `run_count` says
 * whether a revision has been exercised enough to judge at all.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, History, Loader2 } from 'lucide-react';
import { logsService } from '../api';
import agentsService from '../api/agents';
import PageHeader from '../components/layout/PageHeader';
import RevisionEntry from '../components/agents/RevisionEntry';
import { useRestoreRevision } from '../hooks/useRestoreRevision';

/** One request's worth. Large enough that most agents never need a second
 *  page, small enough that the first paint is not the whole history. */
const PAGE_SIZE = 25;

export default function AgentHistory() {
  const { id } = useParams<{ id: string }>();
  const agentId = Number(id);
  const { restore, pending } = useRestoreRevision(agentId);

  const { data: agent } = useQuery({
    queryKey: ['agent', agentId],
    queryFn: () => agentsService.get(agentId),
    enabled: Number.isFinite(agentId),
  });

  const {
    data, isLoading, isError, hasNextPage, fetchNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['agent-revisions', agentId, 'all'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      logsService.listRevisions(agentId, { limit: PAGE_SIZE, cursor: pageParam }),
    getNextPageParam: (last) => (last.has_more ? last.next_cursor : undefined),
    enabled: Number.isFinite(agentId),
  });

  const revisions = data?.pages.flatMap((page) => page.results) ?? [];
  // Only the uncursored first page carries a total; later pages send null.
  const total = data?.pages[0]?.count ?? null;

  return (
    // `h-full overflow-y-auto` for the same reason as Evals: the shell's
    // <main> is `overflow-hidden`, so this page has to own its scroller or the
    // timeline is clipped at the first screen.
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Change history"
        subtitle={
          agent
            ? `Which configuration produced which runs — ${agent.name}`
            : 'Which configuration produced which runs'
        }
        icon={History}
        actions={
          <Link
            to={`/agents/${agentId}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium hover:bg-muted"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to builder
          </Link>
        }
      />

      <div className="px-4 py-6 md:px-8 max-w-3xl">
        {isLoading && (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading history…
          </p>
        )}

        {isError && (
          <p className="text-[13px] text-destructive">
            This history could not be loaded. The agent may have been deleted.
          </p>
        )}

        {!isLoading && !isError && revisions.length === 0 && (
          <p className="text-[13px] text-muted-foreground">
            No changes yet. Future saves will be tracked here.
          </p>
        )}

        {revisions.length > 0 && (
          <>
            {total != null && (
              <p className="mb-4 text-[12px] text-muted-foreground tabular-nums">
                Showing {revisions.length} of {total}{' '}
                {total === 1 ? 'change' : 'changes'}
              </p>
            )}
            {/* Every field opens here: this page exists precisely to be the
                place nothing is elided, so collapsing would send the reader
                back to the builder they came from. */}
            <ol className="space-y-4">
              {revisions.map((rev, i) => (
                <RevisionEntry key={rev.id} revision={rev} collapseAfter={Infinity}
                  // The newest is the current configuration; restoring it would
                  // be a no-op. Newest first is the list's order.
                  onRestore={i === 0 ? undefined : () => restore(rev.number)}
                  restoring={pending === rev.number} />
              ))}
            </ol>
          </>
        )}

        {hasNextPage && (
          <div className="mt-6 flex justify-center">
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-60"
            >
              {isFetchingNextPage && <Loader2 className="w-4 h-4 animate-spin" />}
              {isFetchingNextPage ? 'Loading…' : 'Show more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
