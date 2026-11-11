/**
 * One solution, as the page's detail pane. It picks the view from the
 * solution's status: a draft (its author decides), a row waiting for review
 * (a curator decides), or a library entry (read, judge, edit, remove).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Pencil, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';

import solutionsService, { type DraftFields, type ReviewKind, type Solution } from '../../api/solutions';
import { toast } from '../../lib/toastStore';
import { detailOf, valuesFromSolution } from '../../lib/solutionForm';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import SolutionForm from './SolutionForm';
import { DraftDetail, QueueDetail } from './SolutionWorkflow';
import { SolutionText } from './SolutionParts';
import { markLeaving, restoreRows } from './rowExit';

export interface SolutionDetailProps {
  org: number | null;
  orgName?: string | null;
  id: number;
  /** The viewer is an owner, admin or curator of `org`. */
  canCurate: boolean;
  /** Open a library entry already in its edit form ("Edit" on a row of the attention view). */
  startEditing?: boolean;
  onClose: () => void;
}

export default function SolutionDetail({ org, orgName, id, canCurate, startEditing = false, onClose }: SolutionDetailProps) {
  const qc = useQueryClient();
  const { data: s, isLoading, isError } = useQuery({
    queryKey: ['solution', org, id],
    queryFn: () => solutionsService.get(org, id),
  });
  const changed = () => {
    void qc.invalidateQueries({ queryKey: ['solution', org, id] });
    void qc.invalidateQueries({ queryKey: ['solutions'] });
  };

  // Shaped like the detail it stands in for, so the pane does not jump when it lands.
  if (isLoading) {
    return (
      <div aria-busy="true" aria-label="Loading solution" className="space-y-3">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="mt-4 h-24 w-full" />
      </div>
    );
  }
  if (isError || !s) return <p className="py-6 text-sm text-muted-foreground">This solution is not available.</p>;

  if (s.status === 'draft') {
    return <DraftDetail s={s} org={org} orgName={orgName} onChanged={changed} onClose={onClose} />;
  }
  if (s.status === 'pending_review') {
    return <QueueDetail s={s} org={org} canCurate={canCurate} onChanged={changed} />;
  }
  return <LibraryDetail s={s} org={org} startEditing={startEditing} onChanged={changed} onClose={onClose} />;
}

/** A library entry: read it, say whether it worked, edit it, share it, remove it. */
function LibraryDetail({
  s,
  org,
  startEditing,
  onChanged,
  onClose,
}: {
  s: Solution;
  org: number | null;
  startEditing: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(startEditing);
  const [saveError, setSaveError] = useState<string | null>(null);

  const review = useMutation({
    mutationFn: (kind: ReviewKind) => solutionsService.review(org, s.id, kind, reason),
    onSuccess: () => { setReason(''); onChanged(); toast.success('Recorded.'); },
    onError: (e) => toast.error(detailOf(e, 'Could not record that.')),
  });
  const share = useMutation({
    mutationFn: (shared: boolean) => solutionsService.setShared(org, s.id, shared),
    onSuccess: onChanged,
    onError: (e) => toast.error(detailOf(e, 'Could not change sharing.')),
  });
  const retract = useMutation({
    mutationFn: () => solutionsService.retract(org, s.id),
    onMutate: () => markLeaving(qc, s.id),
    onSuccess: () => { onChanged(); onClose(); toast.success('Removed.'); },
    onError: (e, _vars, snapshot) => {
      if (snapshot) restoreRows(qc, snapshot);
      toast.error(detailOf(e, 'Could not remove it.'));
    },
  });
  const save = useMutation({
    mutationFn: ({ draft, verified }: { draft: DraftFields; verified: boolean }) =>
      solutionsService.update(org, s.id, draft, verified),
    onSuccess: () => {
      setEditing(false);
      setSaveError(null);
      onChanged();
      toast.success('Saved.');
    },
    onError: (e) => setSaveError(detailOf(e, 'Could not save those changes.')),
  });

  if (editing) {
    return (
      <div className="space-y-3">
        <h3 className="text-base font-medium">Edit solution</h3>
        <SolutionForm
          mode="edit"
          initial={valuesFromSolution(s)}
          verifiable
          submitLabel="Save changes"
          busy={save.isPending}
          serverError={saveError}
          onSubmit={(draft, options) => save.mutate({ draft, verified: options.verified })}
          onCancel={() => { setEditing(false); setSaveError(null); }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      <SolutionText s={s} />

      <div className="space-y-2 border-t border-border/60 pt-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => review.mutate('confirmed')} className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-[12px] hover:bg-secondary">
            <ThumbsUp className="h-3.5 w-3.5" /> It worked for me
          </button>
          <button type="button" onClick={() => review.mutate('failed')} className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-[12px] hover:bg-secondary">
            <ThumbsDown className="h-3.5 w-3.5" /> It did not work
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why? (needed to flag or clear a doubt)"
            aria-label="Reason for the review"
            className="min-w-0 flex-1 rounded border border-border bg-background px-2.5 py-1 text-[12px]"
          />
          {s.doubtful ? (
            <button type="button" disabled={!reason.trim()} onClick={() => review.mutate('cleared')} className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-[12px] hover:bg-secondary disabled:opacity-50">
              <CheckCircle2 className="h-3.5 w-3.5" /> Clear doubt
            </button>
          ) : (
            <button type="button" disabled={!reason.trim()} onClick={() => review.mutate('doubt')} className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-[12px] hover:bg-secondary disabled:opacity-50">
              <AlertTriangle className="h-3.5 w-3.5" /> Flag as doubtful
            </button>
          )}
        </div>
        {s.can_manage && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            {org != null && (
              <label className="flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={s.shared_with_org} onChange={(e) => share.mutate(e.target.checked)} />
                Shared with the organisation
              </label>
            )}
            <button type="button" onClick={() => retract.mutate()} className="inline-flex items-center gap-1 text-[12px] text-destructive">
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          </div>
        )}
      </div>

      {(s.reviews ?? []).length > 0 && (
        <section>
          <h4 className="text-[12px] font-semibold uppercase text-muted-foreground">History</h4>
          <ul className="mt-1 space-y-1 text-[12px] text-muted-foreground">
            {(s.reviews ?? []).map((r, i) => (
              <li key={i}>
                {new Date(r.at).toLocaleDateString()} — {r.kind} by {r.by}{r.model ? ` (${r.model})` : ''}{r.reason ? `: ${r.reason}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
