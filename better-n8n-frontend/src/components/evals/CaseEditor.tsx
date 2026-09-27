/**
 * Write or edit one eval case by hand.
 *
 * The other ways in — Generate, From runs, a world — all land as drafts a
 * person accepts. A case written here is already the person's own, so it is
 * saved active. The grader picker is fed by `/api/eval/graders/`, the runner's
 * own registry, so it can never offer a check the runner does not implement;
 * validation (required parameters, the judge-never-alone rule) stays on the
 * server and its message is shown as-is.
 *
 * A case built for a test world is different: its expected answer and its
 * checks were set by the judge and proven against that world, so they are
 * shown read-only. Only the name, weight and active switch can change.
 */
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Modal, ModalBody, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import evalsService, { type EvalCase } from '../../api/evals';
import {
  EMPTY_FORM, firstError, toForm, toPayload, type CaseForm, type GraderRow,
} from '../../lib/evalCase';

const INPUT = 'mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm';

function saveError(err: unknown): string {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  return firstError(data) ?? 'Could not save the case.';
}

export default function CaseEditor({ suiteId, existing, onClose }: {
  suiteId: number;
  /** Absent for a new case. */
  existing?: EvalCase;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CaseForm>(existing ? toForm(existing) : EMPTY_FORM);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fromWorld = existing?.world_version != null;

  const catalog = useQuery({
    queryKey: ['eval', 'graders'],
    queryFn: () => evalsService.graderCatalog(),
    staleTime: Infinity,
  });
  const byType = new Map((catalog.data ?? []).map((g) => [g.type, g]));

  const done = (message: string) => {
    toast.success(message);
    qc.invalidateQueries({ queryKey: ['eval', 'suite', suiteId] });
    qc.invalidateQueries({ queryKey: ['eval', 'suites'] });
    onClose();
  };

  const save = useMutation({
    mutationFn: () => {
      const body = toPayload(form);
      if (fromWorld) {
        return evalsService.updateCase(existing!.id, {
          name: body.name, weight: body.weight, is_active: body.is_active,
        });
      }
      return existing
        ? evalsService.updateCase(existing.id, body)
        : evalsService.createCase(suiteId, body);
    },
    onSuccess: () => done(existing ? 'Case saved' : 'Case added'),
    onError: (e) => toast.error(saveError(e)),
  });
  const remove = useMutation({
    mutationFn: () => evalsService.deleteCase(existing!.id),
    onSuccess: () => done('Case deleted'),
    onError: () => toast.error('Could not delete the case.'),
  });

  const set = <K extends keyof CaseForm>(key: K, value: CaseForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const setGrader = (i: number, row: GraderRow) =>
    set('graders', form.graders.map((g, j) => (j === i ? row : g)));

  const addGrader = () => {
    const first = catalog.data?.find((g) => g.type === 'contains') ?? catalog.data?.[0];
    if (first) set('graders', [...form.graders, { type: first.type, params: {} }]);
  };

  const weight = Number(form.weight);
  const canSave = form.goal.trim() !== '' && Number.isFinite(weight) && weight > 0 && !save.isPending;

  return (
    <>
      <Modal onClose={onClose} size="lg" label={existing ? 'Edit case' : 'New case'}>
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold">{existing ? 'Edit case' : 'Write a case'}</h2>
          {fromWorld && (
            <p className="mt-1 text-xs text-muted-foreground">
              Built for test world v{existing!.world_version}. The judge set its expected answer and
              checks, so only the name, weight and active switch can change here.
            </p>
          )}
        </div>
        <ModalBody className="space-y-4">
          <label className="block">
            <span className="text-xs font-medium">Name</span>
            <input value={form.name} onChange={(e) => set('name', e.target.value)}
              placeholder="Refund window" className={INPUT} />
          </label>

          <label className="block">
            <span className="text-xs font-medium">Goal — what the agent is asked</span>
            <textarea value={form.goal} onChange={(e) => set('goal', e.target.value)} rows={3}
              disabled={fromWorld} placeholder="A customer asks how long they have to return an item."
              className={`${INPUT} resize-y disabled:opacity-60`} />
          </label>

          <label className="block">
            <span className="text-xs font-medium">What a good answer looks like</span>
            <textarea value={form.reference} onChange={(e) => set('reference', e.target.value)} rows={2}
              disabled={fromWorld} placeholder="States the 30-day window and links the returns page."
              className={`${INPUT} resize-y disabled:opacity-60`} />
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Optional. The LLM judge grades against it; the exact checks below do not read it.
            </span>
          </label>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Checks</span>
              {!fromWorld && (
                <Button size="sm" variant="ghost" onClick={addGrader} disabled={!catalog.data?.length}>
                  <Plus className="w-3.5 h-3.5" /> Add check
                </Button>
              )}
            </div>
            {form.graders.length === 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                No checks: a person reviews every result of this case.
              </p>
            )}
            <div className="mt-2 space-y-2">
              {form.graders.map((row, i) => {
                const entry = byType.get(row.type);
                return (
                  <div key={i} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <select value={row.type} disabled={fromWorld}
                        onChange={(e) => setGrader(i, { type: e.target.value, params: {} })}
                        className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-border bg-background text-sm">
                        {/* A stored type the catalogue no longer lists is kept visible. */}
                        {!entry && <option value={row.type}>{row.type}</option>}
                        {(catalog.data ?? []).map((g) => (
                          <option key={g.type} value={g.type}>{g.type}</option>
                        ))}
                      </select>
                      {!fromWorld && (
                        <button type="button" aria-label="Remove check"
                          onClick={() => set('graders', form.graders.filter((_, j) => j !== i))}
                          className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:p-1.5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-red-600 hover:bg-red-500/10">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {entry?.description && (
                      <p className="text-[11px] text-muted-foreground">
                        {entry.description}{entry.calls_model && ' · uses a model, so pair it with an exact check'}
                      </p>
                    )}
                    {(entry?.params ?? Object.keys(row.params)).map((p) => (
                      <label key={p} className="flex items-center gap-2 text-xs">
                        <span className="w-28 shrink-0 text-muted-foreground">
                          {p}{entry?.required.includes(p) && <span className="text-red-600"> *</span>}
                        </span>
                        <input value={row.params[p] ?? ''} disabled={fromWorld}
                          onChange={(e) => setGrader(i, { ...row, params: { ...row.params, [p]: e.target.value } })}
                          className="flex-1 min-w-0 px-2 py-1 rounded border border-border bg-background text-xs disabled:opacity-60" />
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-xs font-medium">
              Weight
              <input type="number" min={0.1} step={0.1} value={form.weight}
                onChange={(e) => set('weight', e.target.value)}
                className="w-20 px-2 py-1 rounded border border-border bg-background text-sm" />
            </label>
            <Switch checked={form.isActive} onChange={(v) => set('isActive', v)} label="Active — included in sweeps" />
          </div>
        </ModalBody>
        <ModalFooter className={existing ? 'justify-between' : undefined}>
          {existing && (
            <Button variant="ghost" onClick={() => setConfirmDelete(true)} className="text-red-600">
              <Trash2 className="w-4 h-4" /> Delete
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!canSave} loading={save.isPending}>
              {existing ? 'Save' : 'Add case'}
            </Button>
          </div>
        </ModalFooter>
      </Modal>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete this case?"
          body="Past sweeps keep their results for it; it just stops being run."
          confirmLabel="Delete"
          danger
          busy={remove.isPending}
          onConfirm={() => remove.mutate()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
