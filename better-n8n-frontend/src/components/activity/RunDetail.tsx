/**
 * One run drawn as the loop it is: turns, each with the model's reasoning and
 * the tool calls that reasoning produced.
 *
 * Moved as-is from `pages/Runs.tsx` during the Activity split. Covers how the
 * run was configured (revision), who asked for it (delegation banner), the
 * plan it worked to, anything it drew or wrote, and the turn-by-turn trace.
 */
import { Brain, Coins, CornerDownRight, GitBranch, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { describeCost, formatCost } from '../../lib/cost';
import MarkdownMessage from '../chat/MarkdownMessage';
import ChartArtifact from '../chat/ChartArtifact';
import PlanView from '../plan/PlanView';
import { historyFrom } from '../../lib/planView';
import PlanPanel from '../orchestration/PlanPanel';
import { planFromOutput } from '../../lib/planStream';
import FileCards from '../files/FileCards';
import type { AgentStep, AgentTurn, ExecutionDetail } from '../../api';
import type { ChartSpec, FileCardData, TodoItem } from '../../api/chat';
import FeedbackControl from '../runs/FeedbackControl';
import evalsService from '../../api/evals';
import { StatusIcon, StatusPill, ms } from './bits';

/** One tool call. Duration bars are scaled to the slowest call in the run, so
 *  the hot spot is obvious without reading numbers. */
function Step({ step, slowest }: { step: AgentStep; slowest: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-secondary">
        <StatusIcon status={step.status} />
        <span className="text-[13px] w-48 truncate" title={step.tool}>{step.tool}</span>
        <div className="flex-1 h-1.5 bg-secondary rounded overflow-hidden">
          {/* block, not inline — an inline element ignores width/height */}
          <span
            className={cn('block h-full rounded', step.status === 'failed' ? 'bg-destructive' : 'bg-agent')}
            style={{ width: `${Math.max(2, ((step.duration_ms || 0) / slowest) * 100)}%` }}
          />
        </div>
        <span className="text-[11px] text-muted-foreground w-14 text-right tabular-nums">
          {ms(step.duration_ms)}
        </span>
      </div>

      {step.error_message && (
        <p className="ml-7 text-[12px] text-destructive">{step.error_message}</p>
      )}

      {/* Runs this call delegated. Each is a real run with its own trace, so it
          links out rather than trying to inline someone else's loop. */}
      {step.delegated_runs.length > 0 && (
        <div className="ml-7 space-y-1 border-l-2 border-agent-line pl-3">
          {step.delegated_runs.map((child) => (
            <div key={child.execution_id} className="flex items-center gap-2 text-[12px]">
              <CornerDownRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              <span className="font-medium">{child.workflow_name ?? 'Deleted agent'}</span>
              <span className="text-muted-foreground truncate flex-1" title={child.task}>
                {child.task}
              </span>
              <StatusPill status={child.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One pass of the model: why it did what it did, then what it did. */
function Turn({ turn, slowest }: { turn: AgentTurn; slowest: number }) {
  return (
    <div className="border-l-2 border-border pl-3 py-1">
      <div className="flex items-center gap-2 mb-1">
        <Brain className="w-3.5 h-3.5 text-agent shrink-0" />
        <span className="text-[12px] font-semibold">Step {turn.index}</span>
        {turn.model_id && (
          <span className="text-[11px] text-muted-foreground truncate" title={turn.model_id}>
            {turn.model_id}
          </span>
        )}
        <span
          className="text-[11px] text-muted-foreground ml-auto tabular-nums"
          title={describeCost(turn.cost_usd, turn.cost_source, turn)}
        >
          {turn.tokens.toLocaleString()} tokens ·{' '}
          <span className={cn(turn.cost_source === 'unpriced' && 'opacity-60')}>
            {formatCost(turn.cost_usd, turn.cost_source)}
          </span>{' '}
          · {ms(turn.duration_ms)}
        </span>
      </div>

      {turn.reasoning ? (
        <div className="prose prose-sm dark:prose-invert max-w-none mb-2 text-muted-foreground prose-p:text-muted-foreground prose-p:leading-relaxed prose-p:text-[13px]">
          <MarkdownMessage content={turn.reasoning} variant="compact" className="text-[13px] leading-relaxed" />
          {/* A trimmed thought and a genuinely brief one must not look alike. */}
          {turn.reasoning_truncated && (
            <span className="text-[11px] italic opacity-70"> […trimmed]</span>
          )}
        </div>
      ) : (
        <p className="text-[12px] italic text-muted-foreground/60 mb-2">
          This model does not expose its reasoning.
        </p>
      )}

      {turn.steps.map((step) => (
        <Step key={step.id} step={step} slowest={slowest} />
      ))}

      {turn.decision === 'answer' && turn.content && (
        <div className="mt-3 prose prose-sm dark:prose-invert max-w-none rounded-lg border border-border bg-card px-4 py-3 shadow-sm prose-headings:font-semibold prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-strong:text-foreground prose-p:text-[13.5px] prose-p:leading-relaxed prose-li:text-[13.5px] prose-ul:my-2 prose-ol:my-2">
          <MarkdownMessage
            content={turn.content + (turn.content_truncated ? "\n\n*… trimmed — open the full trace to see more*" : "")}
            variant="full"
          />
        </div>
      )}
    </div>
  );
}

/** Who delegated this run, and what they were thinking when they did. */
function OrchestratorBanner({ detail }: { detail: { delegated_by: NonNullable<ExecutionDetail['delegated_by']> } }) {
  const by = detail.delegated_by;
  return (
    <div className="mb-3 px-3 py-2 rounded bg-agent-subtle border border-agent-line">
      <div className="flex items-center gap-2 text-[12px] mb-1">
        <GitBranch className="w-3.5 h-3.5 text-agent shrink-0" />
        <span>
          Started by <span className="font-semibold">{by.workflow_name ?? 'a deleted agent'}</span>
          {by.turn_index != null && ` — step ${by.turn_index}`}
        </span>
        <Link
          to={`/runs?run=${by.execution_id}`}
          className="ml-auto text-agent hover:underline"
        >
          Open that run
        </Link>
      </div>
      {by.task && <p className="text-[12px] text-foreground mb-1">Task: {by.task}</p>}
      {by.reasoning && (
        <div className="text-[12px] italic text-muted-foreground leading-relaxed">
          <MarkdownMessage content={by.reasoning} variant="compact" />
        </div>
      )}
    </div>
  );
}

/**
 * What the run cost, and what it was made of.
 *
 * The delegated total is shown as a separate figure rather than folded in: an
 * orchestrator's own spend is usually a rounding error beside its workers', so
 * one blended number would hide which of the two you are reading.
 */
function RunCostSummary({ detail }: { detail: ExecutionDetail }) {
  const unpriced = detail.cost_source === 'unpriced';
  const delegated = detail.delegated_run_count > 0;

  return (
    <div className="flex items-center gap-2 text-[12px] text-muted-foreground flex-wrap">
      <Coins className="w-3.5 h-3.5 shrink-0" />
      <span title={describeCost(detail.cost_usd, detail.cost_source, detail)}>
        {unpriced ? (
          /* Never a number here: no price on record is not the same as free. */
          <>Cost unknown — no price on record for this model</>
        ) : (
          <>
            <span className="font-semibold text-foreground">
              {formatCost(detail.cost_usd, detail.cost_source)}
            </span>
            {detail.cost_source === 'estimated' && ' estimated'}
            {detail.cost_source === 'billed' && ' charged'}
          </>
        )}
      </span>
      {!unpriced && (
        <span className="tabular-nums">
          · {detail.input_tokens.toLocaleString()} in
          {detail.cached_read_tokens > 0 && (
            <> ({detail.cached_read_tokens.toLocaleString()} cached)</>
          )}
          {' '}· {detail.output_tokens.toLocaleString()} out
        </span>
      )}
      {delegated && (
        <span title={describeCost(detail.cost_usd_total, detail.cost_source_total)}>
          · with {detail.delegated_run_count} delegated{' '}
          <span className="font-semibold text-foreground">
            {formatCost(detail.cost_usd_total, detail.cost_source_total)}
          </span>
        </span>
      )}
    </div>
  );
}

/** Everything inside one run: how it was configured, who asked for it, and the
 *  loop it actually ran. */
function RunActions({ detail }: { detail: ExecutionDetail }) {
  const saveAsCase = async () => {
    try {
      const c = await evalsService.caseFromRun({ execution_id: detail.execution_id });
      window.location.href = `/evals?case=${c.id}`;
    } catch {
      // toast is overkill for a best-effort bridge; the console carries it.
      console.warn('Could not save run as eval case');
    }
  };
  return (
    <div className="flex items-center gap-3">
      <FeedbackControl
        target="execution"
        id={detail.execution_id}
        initial={(detail as { feedback?: { rating: number; reason: string; comment: string } | null }).feedback ?? null}
      />
      <button
        onClick={saveAsCase}
        className="text-[12px] px-2 py-1 rounded border border-border hover:bg-secondary"
        title="Save this run as an eval case for the same agent"
      >
        Save as eval case
      </button>
    </div>
  );
}

export default function RunDetail({ detail }: { detail: ExecutionDetail }) {
  // One scale across the whole run, so a bar means the same thing in every
  // turn. Scaling per turn would make a 20ms call in a fast turn look as
  // expensive as a 4s call in a slow one.
  const allSteps = [
    ...detail.turns.flatMap((t) => t.steps),
    ...detail.unattributed_steps,
  ];
  const slowest = Math.max(1, ...allSteps.map((s) => s.duration_ms || 0));

  return (
    <div className="space-y-3">
      {detail.delegated_by && (
        <OrchestratorBanner detail={{ delegated_by: detail.delegated_by }} />
      )}

      <RunActions detail={detail} />

      <RunCostSummary detail={detail} />

      {/* The plan the run worked to, and anything it drew. Both live on
          `output_data` because a run's metadata dies with the graph — without
          this, an agent that charted its findings produced something no reader
          could ever see, and a run that reported blocked steps reported them
          only to itself. */}
      {Array.isArray(detail.output_data?.todos) &&
        (detail.output_data.todos as TodoItem[]).length > 0 &&
        !Array.isArray(detail.output_data?.tasks) && (
          <PlanView history={historyFrom(detail.output_data.todo_history, detail.output_data.todos)} />
        )}

      {/* A team run redraws its panel after the fact from `output_data.tasks`
          — the lanes, owners and final states, read-only. Runs that never
          dispatched keep the inline todo list above. */}
      {Array.isArray(detail.output_data?.tasks) &&
        (detail.output_data.tasks as unknown[]).length > 0 && (() => {
          const replay = planFromOutput(detail.output_data);
          return (
            <PlanPanel
              todos={(detail.output_data.todos as TodoItem[]) ?? []}
              todoHistory={historyFrom(detail.output_data.todo_history, detail.output_data.todos)}
              tasks={replay.tasks}
              leases={[]}
              changes={[]}
              readOnly
            />
          );
        })()}

      {Array.isArray(detail.output_data?.files) && (
        <FileCards files={detail.output_data.files as FileCardData[]} />
      )}

      {Array.isArray(detail.output_data?.charts) &&
        (detail.output_data.charts as ChartSpec[]).map((chart, i) => (
          <ChartArtifact key={`run-chart-${i}`} chart={chart} />
        ))}

      {detail.revision && (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Settings2 className="w-3.5 h-3.5 shrink-0" />
          <span>
            Ran on configuration <span className="font-semibold">v{detail.revision.number}</span>
            {detail.revision.summary && ` — ${detail.revision.summary}`}
          </span>
        </div>
      )}

      {detail.turns.length > 0 ? (
        <div className="space-y-3">
          {detail.turns.map((turn) => (
            <Turn key={turn.index} turn={turn} slowest={slowest} />
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          No steps recorded for this run.
        </p>
      )}

      {/* Steps whose turn is missing — a run older than turn tracking, or a
          write that failed. The agent still did the work, so it still shows. */}
      {detail.unattributed_steps.length > 0 && (
        <div>
          <p className="text-[12px] text-muted-foreground mb-1">
            Other steps
          </p>
          {detail.unattributed_steps.map((step) => (
            <Step key={step.id} step={step} slowest={slowest} />
          ))}
        </div>
      )}

      {detail.steps_truncated && (
        <p className="text-[12px] italic text-muted-foreground">
          Showing the first {allSteps.length} of {detail.step_total} steps.
        </p>
      )}
    </div>
  );
}
