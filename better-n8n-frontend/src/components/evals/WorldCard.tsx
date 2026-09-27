/**
 * The fake situation a suite's cases share.
 *
 * A world is judge-built (fixtures + planted facts + cases with known
 * answers) and draft until a person accepts it here — the same
 * "provisional until asked" rule as draft cases, one step earlier. Accepting
 * a regenerated world invalidates the old version's cases: they stay listed
 * on their version and are never swept.
 */
import { useState } from 'react';
import { AlertCircle, Check, FlaskConical, Loader2, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '../ui/Button';
import evalsService, { type EvalWorld } from '../../api/evals';
import { cn } from '../../lib/utils';

function errorText(err: unknown): string {
  const data = (err as { response?: { data?: { error?: string } } })?.response?.data;
  return data?.error ?? 'Something went wrong.';
}

function fixtureSummary(world: EvalWorld): Array<{ label: string; items: string[] }> {
  const out: Array<{ label: string; items: string[] }> = [];
  const fx = world.fixtures ?? {};
  const files = fx.files as Record<string, string> | undefined;
  if (files && typeof files === 'object' && Object.keys(files).length > 0) {
    out.push({ label: `${Object.keys(files).length} files`, items: Object.keys(files) });
  }
  const kb = fx.kb as { documents?: Array<{ name?: string }> } | undefined;
  if (kb && Array.isArray(kb.documents)) {
    out.push({
      label: `${kb.documents.length} knowledge-base documents`,
      items: kb.documents.map((d) => d?.name ?? '').filter(Boolean),
    });
  }
  const mail = fx.mail as { messages?: Array<{ subject?: string; from?: string }> } | undefined;
  if (mail && Array.isArray(mail.messages)) {
    out.push({
      label: `${mail.messages.length} emails`,
      items: mail.messages.map((m) => `${m?.subject ?? ''} — ${m?.from ?? ''}`),
    });
  }
  const cal = fx.calendar as { events?: Array<{ title?: string; start?: string }> } | undefined;
  if (cal && Array.isArray(cal.events)) {
    out.push({
      label: `${cal.events.length} events`,
      items: cal.events.map((e) => `${e?.title ?? ''} @ ${e?.start ?? ''}`),
    });
  }
  const drive = fx.drive as { files?: Array<{ name?: string }> } | undefined;
  if (drive && Array.isArray(drive.files)) {
    out.push({
      label: `${drive.files.length} drive files`,
      items: drive.files.map((f) => f?.name ?? '').filter(Boolean),
    });
  }
  const web = fx.web as { pages?: Array<{ title?: string; url?: string }> } | undefined;
  if (web && Array.isArray(web.pages)) {
    out.push({
      label: `${web.pages.length} pages`,
      items: web.pages.map((p) => p?.title ?? p?.url ?? '').filter(Boolean),
    });
  }
  return out;
}

function WorldFacts({ world }: { world: EvalWorld }) {
  const [open, setOpen] = useState(false);
  const facts = world.facts ?? [];
  const summary = fixtureSummary(world);
  if (facts.length === 0 && summary.length === 0) return null;
  return (
    <div className="mt-2 text-xs">
      <button type="button" onClick={() => setOpen(!open)}
        className="text-muted-foreground hover:text-foreground transition">
        {open ? 'Hide the planted facts and fixtures' : `Show ${facts.length} planted facts and fixtures`}
      </button>
      {open && (
        <div className="mt-1.5 space-y-2">
          {facts.length > 0 && (
            <ul className="space-y-0.5 text-muted-foreground">
              {facts.map((f, i) => (
                <li key={i}>· {f?.statement ?? String(f?.value ?? '')}</li>
              ))}
            </ul>
          )}
          {summary.map((s) => (
            <div key={s.label}>
              <div className="font-medium text-foreground">{s.label}</div>
              <ul className="text-muted-foreground">
                {s.items.slice(0, 12).map((item, i) => <li key={i} className="truncate">· {item}</li>)}
                {s.items.length > 12 && <li>· …and {s.items.length - 12} more</li>}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GenerateForm({ suiteId, hasAgent, onDone, label }: {
  suiteId: number;
  hasAgent: boolean;
  onDone: () => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState('');
  const [count, setCount] = useState('12');
  const generate = useMutation({
    mutationFn: () => evalsService.generateWorld(suiteId, {
      focus: focus.trim(),
      cases: Math.max(1, Math.min(25, Number(count) || 12)),
    }),
    onSuccess: (res) => {
      // 202: the judge builds it in the background; the card polls until the
      // row turns draft or failed, and a notification lands either way.
      toast.success(
        `Building world v${res.world.version} — this takes a few minutes. You'll get a notification when it's ready.`);
      setOpen(false);
      onDone();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  if (!open) {
    return (
      <Button size="sm" variant="secondary" disabled={!hasAgent || generate.isPending}
        onClick={() => setOpen(true)}
        title={hasAgent ? 'The judge invents a situation, plants facts, and writes cases with known answers' : 'Pick an agent first'}>
        <Sparkles className="w-3.5 h-3.5" /> {label}
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={focus} onChange={(e) => setFocus(e.target.value)}
        placeholder="Focus, e.g. month-end close with duplicate invoices"
        className="flex-1 min-w-40 rounded border border-border bg-card px-2 py-1.5 text-xs"
      />
      <input
        value={count} onChange={(e) => setCount(e.target.value)}
        title="How many cases"
        inputMode="numeric"
        className="w-14 rounded border border-border bg-card px-2 py-1.5 text-xs"
      />
      <Button size="sm" loading={generate.isPending} onClick={() => generate.mutate()}>
        Build it
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}

export default function WorldCard({ suiteId, hasAgent }: {
  suiteId: number;
  hasAgent: boolean;
}) {
  const qc = useQueryClient();
  const world = useQuery({
    queryKey: ['eval', 'world', suiteId],
    queryFn: () => evalsService.getWorld(suiteId),
    // Poll only while a generation is running; stop the moment it settles.
    refetchInterval: (q) => (q.state.data?.pending?.status === 'generating' ? 5000 : false),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['eval', 'world', suiteId] });
    qc.invalidateQueries({ queryKey: ['eval', 'suite', suiteId] });
    qc.invalidateQueries({ queryKey: ['eval', 'suites'] });
  };

  const accept = useMutation({
    mutationFn: (id: number) => evalsService.acceptWorld(id),
    onSuccess: (w) => {
      toast.success(`World v${w.version} accepted — its cases can be accepted now.`);
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => evalsService.deleteWorld(id),
    onSuccess: () => { toast.success('Draft world deleted.'); refresh(); },
    onError: (e) => toast.error(errorText(e)),
  });
  const retry = useMutation({
    mutationFn: (failed: EvalWorld) => evalsService.generateWorld(suiteId, {
      focus: failed.focus, cases: failed.requested_cases,
    }),
    onSuccess: (res) => {
      toast.success(`Building world v${res.world.version} again.`);
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  // When a generation finishes, the drafts it made belong in the case list.
  const pendingStatus = world.data?.pending?.status;
  const [lastPending, setLastPending] = useState(pendingStatus);
  if (pendingStatus !== lastPending) {
    setLastPending(pendingStatus);
    if (lastPending === 'generating') refresh();
  }

  if (world.isLoading) return null;
  const live = world.data?.live ?? null;
  const draft = world.data?.draft ?? null;
  const pending = world.data?.pending ?? null;
  const generating = pending?.status === 'generating';
  // A newer draft, or one being built, supersedes the regenerate button.
  const showGenerate = !draft && !generating;

  return (
    <div className="space-y-2">
      {generating && (
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-2 text-xs">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />
          <span>
            Building world v{pending.version}{pending.focus ? <> — {pending.focus}</> : null}.
            This takes a few minutes; you can leave this page.
          </span>
        </div>
      )}
      {pending?.status === 'failed' && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
              <span className="min-w-0 break-words">
                World v{pending.version} could not be built: {pending.error_message || 'unknown error'}
              </span>
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" disabled={remove.isPending}
                onClick={() => remove.mutate(pending.id)}>
                <Trash2 className="w-3.5 h-3.5" /> Dismiss
              </Button>
              <Button size="sm" variant="secondary" loading={retry.isPending}
                onClick={() => retry.mutate(pending)}>
                <RotateCcw className="w-3.5 h-3.5" /> Try again
              </Button>
            </div>
          </div>
        </div>
      )}
      {draft && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs">
              <span className="font-medium">World v{draft.version} draft</span>
              <span className="text-muted-foreground"> — {draft.brief || 'no brief'}</span>
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" disabled={remove.isPending}
                onClick={() => remove.mutate(draft.id)}>
                <Trash2 className="w-3.5 h-3.5" /> Drop
              </Button>
              <Button size="sm" disabled={accept.isPending}
                loading={accept.isPending} onClick={() => accept.mutate(draft.id)}>
                <Check className="w-3.5 h-3.5" /> Accept world
              </Button>
            </div>
          </div>
          <WorldFacts world={draft} />
          {draft.rejected?.length > 0 && (
            <details className="mt-1.5 text-[11px] text-muted-foreground">
              <summary className="cursor-pointer">
                {draft.rejected.length} drafted case{draft.rejected.length === 1 ? '' : 's'} thrown out
              </summary>
              <ul className="mt-1 list-disc pl-4 space-y-0.5">
                {draft.rejected.map((why, i) => <li key={i} className="break-words">{why}</li>)}
              </ul>
            </details>
          )}
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Nothing scores until this is accepted — and its cases stay drafts until accepted after it.
          </p>
        </div>
      )}

      {live ? (
        <div className="rounded-md border border-border/60 bg-card px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <FlaskConical className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium">World v{live.version}</span>
              <span className="text-muted-foreground truncate">{live.brief || 'no brief'}</span>
            </div>
            <span className="text-muted-foreground whitespace-nowrap">
              {live.case_count} case{live.case_count === 1 ? '' : 's'} on this version
            </span>
          </div>
          <WorldFacts world={live} />
        </div>
      ) : !draft ? (
        <p className="text-xs text-muted-foreground">
          No test world yet. Cases below test what the agent <em>says</em>; a world lets them test what it <em>does</em>.
        </p>
      ) : null}

      {showGenerate && (
        <div className={cn(!live && !draft && 'pt-0.5')}>
          <GenerateForm suiteId={suiteId} hasAgent={hasAgent} onDone={refresh}
            label={live ? 'Regenerate world' : 'Build a test world'} />
          {live && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Regenerating mints a new version — v{live.version} and its scores stay untouched.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
