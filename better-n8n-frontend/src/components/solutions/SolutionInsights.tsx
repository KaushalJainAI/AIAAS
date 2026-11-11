/**
 * The Insights tab (K5.3), for curators: what the team searched for and found
 * over the last 30 days. The server decides who may see it; this component is
 * only shown to curators, and shows whatever the server answered.
 *
 * Nothing here says who asked a question. A question nobody has answered can
 * be answered in place: "Write the answer" opens the solution form with the
 * question as the problem.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';

import solutionsService, { type DraftFields } from '../../api/solutions';
import { detailOf, emptyValues } from '../../lib/solutionForm';
import { answeredPercent, problemFromQuery } from '../../lib/solutionsPage';
import { toast } from '../../lib/toastStore';
import { Button } from '../ui/Button';
import { Modal, ModalBody } from '../ui/Modal';
import { Skeleton } from '../ui/Skeleton';
import SolutionForm from './SolutionForm';

export interface SolutionInsightsProps {
  org: number;
  orgName?: string | null;
  /** The address of a solution in the library tab, for the "Most used" links. */
  hrefFor: (id: number) => string;
}

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-3">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function SolutionInsights({ org, orgName, hrefFor }: SolutionInsightsProps) {
  const qc = useQueryClient();
  const [writing, setWriting] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['solutions', 'insights', org],
    queryFn: () => solutionsService.insights(org),
    retry: false,
  });

  const create = useMutation({
    mutationFn: ({ draft, share }: { draft: DraftFields; share: boolean }) =>
      solutionsService.create(org, draft, share),
    onSuccess: () => {
      setWriting(null);
      setWriteError(null);
      void qc.invalidateQueries({ queryKey: ['solutions'] });
      toast.success('Saved.');
    },
    onError: (e) => setWriteError(detailOf(e, 'Could not save the solution.')),
  });

  if (isLoading) {
    // The four summary tiles, at their rendered height, so the page does not jump when they land.
    return (
      <div aria-busy="true" aria-label="Loading insights" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[84px]" />)}
      </div>
    );
  }
  if (isError || !data) {
    return <p className="py-10 text-center text-sm text-muted-foreground">The insights could not be loaded.</p>;
  }

  return (
    <div className="space-y-8">
      <p className="text-[13px] text-muted-foreground">
        The last 30 days in {orgName ?? 'your organisation'}. Only curators see this page.
      </p>

      <section aria-labelledby="insight-tiles" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <h2 id="insight-tiles" className="sr-only">Summary</h2>
        <Tile label="Searches from chat" value={data.searches} />
        <Tile
          label="Answered"
          value={answeredPercent(data.answered, data.searches)}
          hint={data.searches > 0 ? `${data.unanswered} with nothing found` : undefined}
        />
        <Tile label="Active solutions" value={data.solutions.active} />
        <Tile
          label="Needs attention"
          value={data.solutions.needs_attention}
          hint={data.solutions.needs_attention > 0 ? 'Still true or edit them' : undefined}
        />
      </section>

      <section aria-labelledby="insight-used" className="space-y-2">
        <h2 id="insight-used" className="text-sm font-medium">Most used</h2>
        {data.top_used.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No chat answer has used a team solution yet.</p>
        ) : (
          <ol className="divide-y divide-border/60 rounded-lg border border-border/60 bg-card/60">
            {data.top_used.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <Link to={hrefFor(row.id)} className="min-w-0 flex-1 break-words font-medium text-primary hover:underline">
                  {row.problem}
                </Link>
                <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
                  {row.uses} {row.uses === 1 ? 'use' : 'uses'}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="insight-gaps" className="space-y-2">
        <h2 id="insight-gaps" className="text-sm font-medium">Questions nobody has answered yet</h2>
        {data.gaps.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            {data.searches === 0
              ? 'Nobody has asked the assistant a question in this team yet.'
              : 'Every question asked in the last 30 days found an answer.'}
          </p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-lg border border-border/60 bg-card/60">
            {data.gaps.map((gap) => (
              <li key={gap.query} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="break-words">{problemFromQuery(gap.query)}</p>
                  <p className="text-[12px] text-muted-foreground">
                    Asked {gap.times} {gap.times === 1 ? 'time' : 'times'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => { setWriteError(null); setWriting(problemFromQuery(gap.query)); }}
                >
                  <Pencil className="h-3.5 w-3.5" /> Write the answer
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {writing !== null && (
        <Modal size="lg" label="Write the answer" onClose={() => setWriting(null)}>
          <ModalBody>
            <h2 className="mb-3 text-base font-medium">Write the answer</h2>
            <SolutionForm
              mode="new"
              initial={{ ...emptyValues(), problem: writing }}
              shareOption
              orgName={orgName}
              submitLabel="Save solution"
              busy={create.isPending}
              serverError={writeError}
              onSubmit={(draft, options) => create.mutate({ draft, share: options.share })}
              onCancel={() => setWriting(null)}
            />
          </ModalBody>
        </Modal>
      )}
    </div>
  );
}
