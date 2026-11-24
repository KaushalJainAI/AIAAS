/**
 * Loads one change set and runs its revert for `ChangesSheet`. Chat and the
 * run page both open the sheet through this, so the loading, the revert and
 * the summary toast live in one place.
 */
import { useChangeSet } from '@/hooks/useChangeSet';
import { toast } from '@/lib/toastStore';
import { summariseRevert } from '@/lib/changeSummary';
import { ChangesSheet } from './ChangesSheet';

export default function ChangesSheetContainer({
  setId,
  onClose,
}: {
  setId: number;
  onClose: () => void;
}) {
  const changes = useChangeSet(setId);

  const revert = async (changeIds: number[]) => {
    try {
      const result = await changes.revert(changeIds);
      const clean = result.skipped === 0 && result.failed === 0;
      if (clean) toast.success(summariseRevert(result));
      else toast.warning(summariseRevert(result));
    } catch (error) {
      // A 409 arrives here with the server's own sentence (still running, and so on).
      toast.error('Nothing was undone', messageOf(error));
    }
  };

  return (
    <ChangesSheet
      detail={changes.detail}
      loading={changes.isLoading}
      error={changes.isError ? messageOf(changes.error, 'Could not load these changes.') : undefined}
      onRetry={() => void changes.reload()}
      reverting={changes.reverting}
      result={changes.result}
      onRevert={(ids) => void revert(ids)}
      onClose={onClose}
    />
  );
}

function messageOf(error: unknown, fallback?: string): string | undefined {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
