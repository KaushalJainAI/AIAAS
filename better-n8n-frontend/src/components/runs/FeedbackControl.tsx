/**
 * Thumbs up/down with optimistic update, revert on error. Never blocks.
 */
import { useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { logsService } from '../../api';
import { cn } from '../../lib/utils';

const REASONS = ['wrong', 'incomplete', 'slow', 'unsafe', 'ignored_instructions', 'other'] as const;

export default function FeedbackControl({
  target, id, initial,
}: {
  target: 'execution' | 'message';
  id: string | number;
  initial?: { rating: number; reason: string; comment: string } | null;
}) {
  const qc = useQueryClient();
  const [rating, setRating] = useState<number | null>(initial?.rating ?? null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(initial?.reason ?? 'wrong');
  const [comment, setComment] = useState(initial?.comment ?? '');

  const submit = useMutation({
    mutationFn: (r: 1 | -1) =>
      logsService.submitFeedback({ target, id, rating: r, reason, comment }),
    onMutate: (r) => {
      const prev = rating;
      setRating(r);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      setRating((ctx as { prev: number | null } | undefined)?.prev ?? null);
      toast.error('Could not save feedback');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['run'] });
      if (rating === -1) setOpen(false);
    },
  });

  return (
    <span className="inline-flex items-center gap-1">
      <button
        title="Good"
        aria-label="Thumbs up"
        onClick={() => submit.mutate(1)}
        className={cn(
          'p-1 rounded hover:bg-secondary',
          rating === 1 ? 'text-emerald-600' : 'text-muted-foreground',
        )}
      >
        <ThumbsUp className="w-4 h-4" />
      </button>
      <button
        title="Bad"
        aria-label="Thumbs down"
        onClick={() => (rating === -1 ? setOpen((o) => !o) : (setOpen(true), submit.mutate(-1)))}
        className={cn(
          'p-1 rounded hover:bg-secondary',
          rating === -1 ? 'text-red-600' : 'text-muted-foreground',
        )}
      >
        <ThumbsDown className="w-4 h-4" />
      </button>
      {open && (
        <span className="inline-flex items-center gap-1 ml-1">
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="text-xs border border-border rounded px-1 py-0.5 bg-background"
          >
            {REASONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="optional comment"
            maxLength={2000}
            className="text-xs border border-border rounded px-1 py-0.5 bg-background w-32"
          />
          <button
            onClick={() => submit.mutate(-1)}
            className="text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground"
          >
            Save
          </button>
        </span>
      )}
    </span>
  );
}
