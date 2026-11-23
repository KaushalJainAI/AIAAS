/**
 * Restore an agent to an earlier revision, from wherever revisions are listed.
 *
 * One hook because the builder and `/agents/:id/history` both list revisions,
 * and a restore has three things to refresh afterwards — the agent, its
 * revision list and the agents list — which two copies would drift on.
 * The server's refusal (a connection or skill the old version named is gone)
 * is shown as the server wrote it: it names what to fix.
 *
 * The confirm is the app's own dialog, not `window.confirm`: the hook returns
 * it as `dialog`, and each caller renders `{dialog}` once.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import agentsService, { type Agent } from '../api/agents';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

export function useRestoreRevision(agentId: number, onRestored?: (agent: Agent) => void) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<number | null>(null);
  /** The version the user asked to restore, waiting on the confirm. */
  const [asking, setAsking] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: (number: number) => agentsService.restoreRevision(agentId, number),
    onMutate: (number) => setPending(number),
    onSettled: () => setPending(null),
    onSuccess: (agent, number) => {
      queryClient.invalidateQueries({ queryKey: ['agent'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['agent-revisions', agentId] });
      toast.success(`Restored version ${number} — saved as a new version`);
      onRestored?.(agent);
    },
    onError: (err: { response?: { data?: Record<string, unknown> } }) => {
      const data = err.response?.data;
      const first = data && Object.entries(data)[0];
      toast.error(first
        ? `Could not restore: ${first[0] === 'error' ? '' : `${first[0]}: `}${String(Array.isArray(first[1]) ? first[1][0] : first[1])}`
        : 'Could not restore that version.');
    },
  });

  const dialog = asking === null ? null : (
    <ConfirmDialog
      title={`Restore version ${asking}?`}
      body={`Put this agent back to version ${asking}? Your current settings stay in the history.`}
      confirmLabel="Restore"
      danger={false}
      onCancel={() => setAsking(null)}
      onConfirm={() => {
        const number = asking;
        setAsking(null);
        mutation.mutate(number);
      }}
    />
  );

  return {
    restore: (number: number) => setAsking(number),
    pending,
    dialog,
  };
}
