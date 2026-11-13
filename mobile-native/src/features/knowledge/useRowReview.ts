import { useState } from 'react';

import { confirm } from '../../components/confirm';
import { success, warning } from '../../lib/haptics';
import type { RowActions } from './ExtractedRowCard';
import { useReviewRow } from './queries';

/**
 * Accept, fix or reject held rows, with the same outcome words as the web
 * (Corrected, Rejected, Accepted). Rejecting asks first; it is kept as rejected.
 */
export function useRowReview() {
  const review = useReviewRow();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = (rowId: number, body?: { data?: Record<string, unknown>; reject?: boolean }) => {
    setError(null);
    setNotice(null);
    review.mutate({ rowId, body }, {
      onSuccess: (res) => {
        const word = res.corrected ? 'Corrected' : res.status === 'rejected' ? 'Rejected' : 'Accepted';
        if (word === 'Rejected') warning();
        else success();
        setNotice(`${word}.`);
      },
      onError: () => setError('Could not save that review.'),
    });
  };

  const actions: RowActions = {
    onAccept: (row) => send(row.id),
    onFix: (row, data) => send(row.id, { data }),
    onReject: (row) => {
      void confirm({
        title: 'Reject this row?',
        message: 'It stays in the list as rejected.',
        destructiveLabel: 'Reject',
      }).then((ok) => {
        if (ok) send(row.id, { reject: true });
      });
    },
  };

  return { actions, busy: review.isPending, notice, error };
}
