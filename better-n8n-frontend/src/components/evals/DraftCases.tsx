/**
 * Test data the owner did not have to write.
 *
 * Two buttons fill a suite — "Generate" (the judge model drafts cases from the
 * agent's own configuration) and "From runs" (what the agent was really asked)
 * — and both land as drafts. The runner skips drafts, so nothing a model wrote
 * is scored until someone accepts it here: the same "provisional until a
 * person has been asked" rule as the review queue, one step earlier.
 */
import { useState } from 'react';
import { Check, History, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '../ui/Button';
import evalsService, { type EvalCase, type GeneratedCases } from '../../api/evals';
import { cn } from '../../lib/utils';

/** Category tags the generator writes, in the words the review list shows. */
const CATEGORY_LABELS: Record<string, string> = {
  normal: 'Normal task',
  ambiguous: 'Should ask',
  impossible: 'Should give up',
  gated: 'Needs approval',
  trap: 'Trap',
  'from-run': 'From a real run',
};

function category(c: EvalCase): string {
  const hit = c.tags.find((t) => t in CATEGORY_LABELS);
  if (c.tags.includes('from-run')) return 'from-run';
  return hit ?? 'normal';
}

function errorText(err: unknown): string {
  const data = (err as { response?: { data?: { error?: string } } })?.response?.data;
  return data?.error ?? 'Something went wrong.';
}

/** Facts a world case's answer rests on (`__facts__` rides input_data but is harness, not input). */
function DraftFacts({ inputData }: { inputData: EvalCase['input_data'] }) {
  const facts = (inputData ?? {})['__facts__'];
  if (!Array.isArray(facts) || facts.length === 0) return null;
  return (
    <div><span className="text-foreground">Rests on facts:</span> {facts.map(String).join(', ')}</div>
  );
}

/** Input data minus harness keys (`__workspace__`, `__facts__`, …): those are instructions, never shown to the agent. */
function DraftInputs({ inputData }: { inputData: EvalCase['input_data'] }) {
  const visible = Object.fromEntries(
    Object.entries(inputData ?? {}).filter(([k]) => !k.startsWith('__')),
  );
  if (Object.keys(visible).length === 0) return null;
  return (
    <pre className="whitespace-pre-wrap break-words rounded bg-muted/60 p-2 text-[11px]">
      {JSON.stringify(visible, null, 2)}
    </pre>
  );
}

export default function DraftCases({ suiteId, hasAgent, drafts }: {
  suiteId: number;
  hasAgent: boolean;
  drafts: EvalCase[];
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<number | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['eval', 'suite', suiteId] });
    qc.invalidateQueries({ queryKey: ['eval', 'suites'] });
  };

  const report = (verb: string) => (res: GeneratedCases) => {
    const n = res.cases.length;
    const extra = [
      res.rejected?.length ? `${res.rejected.length} thrown out` : '',
      res.already_imported ? `${res.already_imported} already imported` : '',
      res.cost_usd ? `$${Number(res.cost_usd).toFixed(4)}` : '',
    ].filter(Boolean).join(' · ');
    toast.success(`${verb} ${n} draft case${n === 1 ? '' : 's'}${extra ? ` (${extra})` : ''}`);
    refresh();
  };

  const generate = useMutation({
    mutationFn: () => evalsService.generateCases(suiteId, { count: 12 }),
    onSuccess: report('Generated'),
    onError: (e) => {
      const message = errorText(e);
      // A suite with an accepted world builds cases from the world instead;
      // the backend names its route, which means nothing here.
      toast.error(message.includes('accepted world')
        ? 'This suite has a test world — build cases from the world above.'
        : message);
    },
  });
  const importRuns = useMutation({
    mutationFn: () => evalsService.importRuns(suiteId, { limit: 20 }),
    onSuccess: report('Imported'),
    onError: (e) => toast.error(errorText(e)),
  });
  const review = useMutation({
    mutationFn: (body: { accept?: number[]; reject?: number[] }) =>
      evalsService.reviewDrafts(suiteId, body),
    onSuccess: (res) => {
      // Cases built for a version whose world is not accepted stay drafts.
      if (res.refused?.length) {
        toast.warning(`${res.refused.length} case${res.refused.length === 1 ? '' : 's'} still need${res.refused.length === 1 ? 's' : ''} an accepted world — accept the world above first.`);
      }
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const busy = generate.isPending || importRuns.isPending;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={!hasAgent || busy}
          loading={generate.isPending} onClick={() => generate.mutate()}
          title={hasAgent ? 'The judge model drafts about 12 cases from this agent’s setup' : 'Pick an agent first'}>
          <Sparkles className="w-3.5 h-3.5" /> Generate cases
        </Button>
        <Button size="sm" variant="secondary" disabled={!hasAgent || busy}
          loading={importRuns.isPending} onClick={() => importRuns.mutate()}
          title={hasAgent ? 'Turn this agent’s recent runs into cases' : 'Pick an agent first'}>
          <History className="w-3.5 h-3.5" /> From recent runs
        </Button>
        {generate.isPending && (
          <span className="text-[11px] text-muted-foreground">Writing cases — this takes about a minute.</span>
        )}
      </div>

      {drafts.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-amber-500/20">
            <span className="text-xs font-medium">
              {drafts.length} draft{drafts.length === 1 ? '' : 's'} to review — not scored until accepted
            </span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" disabled={review.isPending}
                onClick={() => review.mutate({ reject: drafts.map((d) => d.id) })}>
                Reject all
              </Button>
              <Button size="sm" disabled={review.isPending}
                onClick={() => review.mutate({ accept: drafts.map((d) => d.id) })}>
                Accept all
              </Button>
            </div>
          </div>
          <ul className="divide-y divide-border/40">
            {drafts.map((d) => (
              <li key={d.id} className="px-3 py-2 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <button type="button" className="min-w-0 text-left flex-1"
                    onClick={() => setOpen(open === d.id ? null : d.id)}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                        'bg-muted text-muted-foreground',
                      )}>
                        {CATEGORY_LABELS[category(d)]}
                      </span>
                      <span className="font-medium truncate">{d.name || `Case ${d.id}`}</span>
                    </div>
                    <div className={cn('text-muted-foreground mt-0.5', open === d.id ? 'whitespace-pre-wrap' : 'truncate')}>
                      {d.goal}
                    </div>
                  </button>
                  <div className="flex gap-1 shrink-0">
                    <button type="button" aria-label="Reject draft"
                      className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:p-1.5 inline-flex items-center justify-center rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-600"
                      disabled={review.isPending} onClick={() => review.mutate({ reject: [d.id] })}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" aria-label="Accept draft"
                      className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:p-1.5 inline-flex items-center justify-center rounded hover:bg-emerald-500/10 text-muted-foreground hover:text-emerald-600"
                      disabled={review.isPending} onClick={() => review.mutate({ accept: [d.id] })}>
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {open === d.id && (
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    {d.reference && <div><span className="text-foreground">Good outcome:</span> {d.reference}</div>}
                    <DraftFacts inputData={d.input_data} />
                    <DraftInputs inputData={d.input_data} />
                    <div>
                      <span className="text-foreground">Checks:</span>{' '}
                      {d.graders.map((g) => g.type).join(', ')}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
