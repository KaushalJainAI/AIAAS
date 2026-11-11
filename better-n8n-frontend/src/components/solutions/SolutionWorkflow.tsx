/**
 * The two views a solution has before it is in the library: a draft its author
 * decides about, and a row waiting for a curator. The rules are the server's
 * (`solutions/api.py`); these views only offer the choices that apply.
 */
import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Pencil, Trash2 } from 'lucide-react';

import solutionsService, { type DraftFields, type Solution } from '../../api/solutions';
import { toast } from '../../lib/toastStore';
import { detailOf, valuesFromSolution } from '../../lib/solutionForm';
import { Button } from '../ui/Button';
import SolutionForm from './SolutionForm';
import { Badges, SolutionText } from './SolutionParts';
import { markLeaving, restoreRows } from './rowExit';

/** Save the author's edits to a draft or a row waiting for review. */
function useSaveText(org: number | null, s: Solution, onChanged: () => void, done: string) {
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (draft: DraftFields) => solutionsService.update(org, s.id, draft, false),
    onSuccess: () => { setError(null); onChanged(); toast.success(done); },
    onError: (e) => setError(detailOf(e, 'Could not save those changes.')),
  });
  return { save, error };
}

export function DraftDetail({
  s,
  org,
  orgName,
  onChanged,
  onClose,
}: {
  s: Solution;
  org: number | null;
  orgName?: string | null;
  onChanged: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const { save, error } = useSaveText(org, s, onChanged, 'Draft saved.');

  // Leaving the drafts list either way (kept, shared or sent to review), so the row collapses at once.
  const publish = useMutation({
    mutationFn: (share: boolean) => solutionsService.publish(org, s.id, share),
    onMutate: () => markLeaving(qc, s.id),
    onSuccess: (saved, share) => {
      onChanged();
      if (!share) toast.success('Kept private.');
      else if (saved.status === 'pending_review') toast.success('Sent to the curators for review.');
      else toast.success(`Shared with ${orgName ?? 'your team'}.`);
    },
    onError: (e, _share, snapshot) => {
      if (snapshot) restoreRows(qc, snapshot);
      toast.error(detailOf(e, 'Could not save that choice.'));
    },
  });
  const discard = useMutation({
    mutationFn: () => solutionsService.discard(org, s.id),
    onMutate: () => markLeaving(qc, s.id),
    onSuccess: () => { onChanged(); onClose(); toast.success('Discarded.'); },
    onError: (e, _vars, snapshot) => {
      if (snapshot) restoreRows(qc, snapshot);
      toast.error(detailOf(e, 'Could not discard it.'));
    },
  });
  const busy = publish.isPending || discard.isPending;

  return (
    <div className="space-y-5 text-sm">
      <div className="space-y-1">
        <Badges s={s} />
        <h3 className="pt-1 text-base font-medium">Review this draft</h3>
        <p className="text-[13px] text-muted-foreground">
          {s.share_requested
            ? 'Sharing was on in the chat where this was found.'
            : 'Sharing was off in the chat where this was found.'}
          {' '}Only you can see a draft until you choose.
        </p>
      </div>

      <SolutionForm
        mode="edit"
        initial={valuesFromSolution(s)}
        submitLabel="Save changes"
        busy={save.isPending}
        serverError={error}
        onSubmit={(draft) => save.mutate(draft)}
      />

      <div className="space-y-2 border-t border-border/60 pt-3">
        <p className="text-[13px] font-medium">Keep it?</p>
        <div className="flex flex-wrap gap-2">
          {orgName && (
            <Button
              variant={s.share_requested ? 'primary' : 'secondary'}
              disabled={busy}
              loading={publish.isPending && publish.variables === true}
              onClick={() => publish.mutate(true)}
            >
              Share with {orgName}
            </Button>
          )}
          <Button variant="secondary" disabled={busy} loading={publish.isPending && publish.variables === false} onClick={() => publish.mutate(false)}>
            Keep private
          </Button>
          {confirmDiscard ? (
            <>
              <Button variant="destructive" disabled={busy} loading={discard.isPending} onClick={() => discard.mutate()}>
                Yes, discard it
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmDiscard(false)}>
                Keep it
              </Button>
            </>
          ) : (
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmDiscard(true)}>
              <Trash2 className="h-3.5 w-3.5" /> Discard
            </Button>
          )}
        </div>
        <p className="text-[12px] text-muted-foreground">
          Sharing makes it visible to your team. In an organisation where a curator approves each share, it waits for one first.
          Keeping it private leaves it in your own library.
        </p>
      </div>
    </div>
  );
}

export function QueueDetail({
  s,
  org,
  canCurate,
  onChanged,
}: {
  s: Solution;
  org: number | null;
  canCurate: boolean;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const reasonId = useId();
  const [editing, setEditing] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const [reason, setReason] = useState('');
  const { save, error } = useSaveText(org, s, () => { setEditing(false); onChanged(); }, 'Saved.');

  const approve = useMutation({
    mutationFn: () => solutionsService.approve(org, s.id),
    onMutate: () => markLeaving(qc, s.id),
    onSuccess: () => { onChanged(); toast.success('Approved for the team.'); },
    onError: (e, _vars, snapshot) => {
      if (snapshot) restoreRows(qc, snapshot);
      toast.error(detailOf(e, 'Could not approve it.'));
    },
  });
  const sendBack = useMutation({
    mutationFn: () => solutionsService.sendBack(org, s.id, reason.trim()),
    onMutate: () => markLeaving(qc, s.id),
    onSuccess: () => {
      setReason('');
      setSendingBack(false);
      onChanged();
      toast.success('Sent back to its author.');
    },
    onError: (e, _vars, snapshot) => {
      if (snapshot) restoreRows(qc, snapshot);
      toast.error(detailOf(e, 'Could not send it back.'));
    },
  });

  if (editing) {
    return (
      <div className="space-y-3">
        <h3 className="text-base font-medium">Edit before deciding</h3>
        <SolutionForm
          mode="edit"
          initial={valuesFromSolution(s)}
          submitLabel="Save changes"
          busy={save.isPending}
          serverError={error}
          onSubmit={(draft) => save.mutate(draft)}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      <p className="rounded-md border border-warning/40 bg-warning/10 p-2.5 text-[13px]">
        {canCurate
          ? 'Waiting for a curator. Approve it for the team, or send it back to its author with a reason.'
          : 'Waiting for a curator. Until one approves it, only you and the curators can see it.'}
      </p>

      <SolutionText s={s} />

      {canCurate && (
        <div className="space-y-3 border-t border-border/60 pt-3">
          <div className="flex flex-wrap gap-2">
            <Button loading={approve.isPending} disabled={sendBack.isPending} onClick={() => approve.mutate()}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Approve for the team
            </Button>
            <Button
              variant="secondary"
              aria-expanded={sendingBack}
              disabled={approve.isPending}
              onClick={() => setSendingBack((v) => !v)}
            >
              Send back
            </Button>
            <Button variant="secondary" disabled={approve.isPending} onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          </div>

          {sendingBack && (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (reason.trim()) sendBack.mutate();
              }}
            >
              <label htmlFor={reasonId} className="block text-[13px] font-medium">
                Why is it being sent back? <span className="text-destructive" aria-hidden="true">*</span>
              </label>
              <textarea
                id={reasonId}
                required
                aria-required="true"
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full min-w-0 rounded border border-border bg-background px-2.5 py-1.5 text-sm"
              />
              <p className="text-[12px] text-muted-foreground">
                The author gets this reason. It goes back to being their private fix until they share it again.
              </p>
              <Button type="submit" variant="destructive" disabled={!reason.trim()} loading={sendBack.isPending}>
                Send back to the author
              </Button>
            </form>
          )}
        </div>
      )}

      {!canCurate && s.can_manage && (
        <div className="border-t border-border/60 pt-3">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        </div>
      )}
    </div>
  );
}
