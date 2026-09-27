/**
 * Run an agent now, by hand.
 *
 * `POST agents/{id}/execute/` existed from the start and nothing in the web app
 * called it: the only ways to run an agent were asking chat to, or firing one
 * of its schedules. So "does my agent work?" could not be answered from the
 * screen where the agent is built.
 *
 * The goal is prefilled with the brief because that is what a schedule runs
 * with when it has no goal of its own, so a test run here is the same run a
 * schedule would start. A refusal (spend cap, missing key, paused) comes back
 * before any run exists and is shown in place, rather than as a toast that
 * disappears before it is read.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play } from 'lucide-react';
import { toast } from 'sonner';
import agentsService from '../../api/agents';
import { Button } from '../ui/Button';
import { Modal, ModalFooter } from '../ui/Modal';

interface RunAgentDialogProps {
  agentId: number;
  agentName: string;
  brief: string;
  /** Unsaved edits on the board: a run uses what is saved, and must say so. */
  dirty?: boolean;
  onClose: () => void;
}

export default function RunAgentDialog({
  agentId, agentName, brief, dirty = false, onClose,
}: RunAgentDialogProps) {
  const navigate = useNavigate();
  const [goal, setGoal] = useState(brief);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (!goal.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const started = await agentsService.execute(agentId, goal.trim());
      toast.success(`${agentName} is running`);
      onClose();
      navigate(`/runs?run=${encodeURIComponent(started.execution_id)}`);
    } catch (err) {
      const data = (err as { response?: { data?: { error?: string } } }).response?.data;
      setError(data?.error ?? 'The run could not be started.');
      setBusy(false);
    }
  };

  return (
    <Modal size="md" label={`Run ${agentName}`} onClose={onClose}>
      <div className="p-6 space-y-3">
        <h3 className="text-lg font-semibold">Run {agentName} now</h3>
        <label className="block text-[13px] font-medium" htmlFor="run-goal">
          What should it do this time?
        </label>
        <textarea
          id="run-goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={4}
          autoFocus
          placeholder="Describe the task for this run…"
          className="w-full px-3 py-2 rounded border border-input bg-background text-sm resize-none"
        />
        {dirty && (
          <p className="text-[12px] text-warning">
            You have unsaved changes. This run uses the saved configuration.
          </p>
        )}
        {error && (
          <p role="alert" className="text-[12px] text-destructive">{error}</p>
        )}
      </div>
      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant="primary" size="sm" loading={busy}
          disabled={!goal.trim()} onClick={start}>
          {!busy && <><Play className="w-3.5 h-3.5 mr-1" />Run</>}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
