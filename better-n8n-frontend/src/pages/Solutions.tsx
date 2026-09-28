/**
 * Organisation & Solutions — who you share with, and what you have solved.
 *
 * Two tabs (`?tab=solutions|organisation`): the solutions library, and the
 * organisation settings that used to sit in Settings (create an org, add
 * people, pick where new chats start). They share a page because the second
 * decides what the first shows.
 *
 * Solutions — problems your organisation has already solved.
 *
 * Saved automatically when someone says a fix worked (or gives it a thumbs
 * up), or by the assistant when a problem is clearly solved. The assistant
 * searches this library first for troubleshooting questions; this page is
 * where people read it, say whether a fix worked, flag one that looks wrong,
 * change who can see it, or remove it.
 *
 * Each claim in a fix carries how fast it goes stale; a claim past its window
 * is marked "check", and the assistant must re-verify it or say it may have
 * changed before relying on it.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Building2, CheckCircle2, Lightbulb, Loader2, Search, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';

import orgsService from '../api/orgs';
import solutionsService, { type ReviewKind, type Solution } from '../api/solutions';
import PageHeader from '../components/layout/PageHeader';
import OrganizationTab from '../components/settings/OrganizationTab';
import { toast } from '../lib/toastStore';
import { cn } from '../lib/utils';

const KIND_LABEL: Record<string, string> = {
  principle: 'General rule',
  procedure: 'Steps',
  versioned: 'Version-specific',
  config: 'Setting',
  time_sensitive: 'Changes often',
  ephemeral: 'Momentary',
};

function detailOf(error: unknown, fallback: string): string {
  return (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

function Badges({ s }: { s: Solution }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-[11px]">
      {s.doubtful && (
        <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-3 w-3" /> Doubtful
        </span>
      )}
      {s.status === 'needs_check' && (
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">Needs check</span>
      )}
      {s.status === 'superseded' && (
        <span className="rounded bg-secondary px-1.5 py-0.5 text-muted-foreground">Replaced</span>
      )}
      {s.checks_needed.length > 0 && (
        <span className="rounded bg-secondary px-1.5 py-0.5 text-muted-foreground">
          {s.checks_needed.length} claim{s.checks_needed.length === 1 ? '' : 's'} may be out of date
        </span>
      )}
      <span className="rounded bg-secondary px-1.5 py-0.5 text-muted-foreground">
        {s.shared_with_org ? 'Shared' : 'Private'}
      </span>
    </div>
  );
}

function Detail({ org, id, onClose }: { org: number | null; id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const { data: s, isLoading, isError } = useQuery({
    queryKey: ['solution', org, id],
    queryFn: () => solutionsService.get(org, id),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['solution', org, id] });
    void qc.invalidateQueries({ queryKey: ['solutions'] });
  };
  const review = useMutation({
    mutationFn: (kind: ReviewKind) => solutionsService.review(org, id, kind, reason),
    onSuccess: () => { setReason(''); refresh(); toast.success('Recorded.'); },
    onError: (e) => toast.error(detailOf(e, 'Could not record that.')),
  });
  const share = useMutation({
    mutationFn: (shared: boolean) => solutionsService.setShared(org, id, shared),
    onSuccess: refresh,
    onError: (e) => toast.error(detailOf(e, 'Could not change sharing.')),
  });
  const retract = useMutation({
    mutationFn: () => solutionsService.retract(org, id),
    onSuccess: () => { refresh(); onClose(); toast.success('Removed.'); },
    onError: (e) => toast.error(detailOf(e, 'Could not remove it.')),
  });

  if (isLoading) return <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-muted-foreground" />;
  if (isError || !s) return <p className="py-6 text-sm text-muted-foreground">This solution is not available.</p>;

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="text-base font-medium">{s.problem}</h3>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Solved by {s.solved_by}{s.solved_on ? ` on ${s.solved_on}` : ''} · last known true {s.last_known_true}
          {' '}· worked for {s.track_record.worked}, failed for {s.track_record.failed}
        </p>
        <div className="mt-2"><Badges s={s} /></div>
      </div>
      {s.doubtful && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[13px]">
          <strong>Flagged as possibly wrong:</strong> {s.doubtful}
        </p>
      )}
      {s.symptoms && (<section><h4 className="text-[12px] font-semibold uppercase text-muted-foreground">Symptoms</h4><pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[12px]">{s.symptoms}</pre></section>)}
      {s.root_cause && (<section><h4 className="text-[12px] font-semibold uppercase text-muted-foreground">Cause</h4><p className="mt-1 whitespace-pre-wrap">{s.root_cause}</p></section>)}
      <section><h4 className="text-[12px] font-semibold uppercase text-muted-foreground">Fix</h4><p className="mt-1 whitespace-pre-wrap">{s.resolution}</p></section>
      {s.claims.length > 0 && (
        <section>
          <h4 className="text-[12px] font-semibold uppercase text-muted-foreground">What could change</h4>
          <ul className="mt-1 space-y-1">
            {s.claims.map((c, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <span className={cn('rounded px-1.5 py-0.5 text-[11px]',
                  c.state === 'check' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300')}>
                  {c.state === 'check' ? 'Check' : 'Current'}
                </span>
                <span className="text-[11px] text-muted-foreground">{KIND_LABEL[c.kind] ?? c.kind}</span>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {Object.keys(s.environment || {}).length > 0 && (
        <p className="text-[12px] text-muted-foreground">
          Applied to: {Object.entries(s.environment).map(([k, v]) => `${k} ${v}`).join(', ')}
        </p>
      )}

      <div className="space-y-2 border-t border-border/60 pt-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => review.mutate('confirmed')} className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-[12px] hover:bg-secondary">
            <ThumbsUp className="h-3.5 w-3.5" /> It worked for me
          </button>
          <button type="button" onClick={() => review.mutate('failed')} className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-[12px] hover:bg-secondary">
            <ThumbsDown className="h-3.5 w-3.5" /> It did not work
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? (needed to flag or clear a doubt)"
            className="min-w-0 flex-1 rounded border border-border bg-background px-2.5 py-1 text-[12px]" />
          {s.doubtful ? (
            <button type="button" disabled={!reason.trim()} onClick={() => review.mutate('cleared')} className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-[12px] hover:bg-secondary disabled:opacity-50">
              <CheckCircle2 className="h-3.5 w-3.5" /> Clear doubt
            </button>
          ) : (
            <button type="button" disabled={!reason.trim()} onClick={() => review.mutate('doubt')} className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-[12px] hover:bg-secondary disabled:opacity-50">
              <AlertTriangle className="h-3.5 w-3.5" /> Flag as doubtful
            </button>
          )}
        </div>
        {s.can_manage && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            {org != null && (
              <label className="flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={s.shared_with_org} onChange={(e) => share.mutate(e.target.checked)} />
                Shared with the organisation
              </label>
            )}
            <button type="button" onClick={() => retract.mutate()} className="inline-flex items-center gap-1 text-[12px] text-destructive">
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          </div>
        )}
      </div>

      {(s.reviews ?? []).length > 0 && (
        <section>
          <h4 className="text-[12px] font-semibold uppercase text-muted-foreground">History</h4>
          <ul className="mt-1 space-y-1 text-[12px] text-muted-foreground">
            {(s.reviews ?? []).map((r, i) => (
              <li key={i}>
                {new Date(r.at).toLocaleDateString()} — {r.kind} by {r.by}{r.model ? ` (${r.model})` : ''}{r.reason ? `: ${r.reason}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

type Tab = 'solutions' | 'organisation';

const TABS: { id: Tab; label: string; icon: typeof Lightbulb }[] = [
  { id: 'solutions', label: 'Solutions', icon: Lightbulb },
  { id: 'organisation', label: 'Organisation', icon: Building2 },
];

export default function OrganisationAndSolutions() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'organisation' ? 'organisation' : 'solutions';
  const pick = (next: Tab) => {
    const q = new URLSearchParams(params);
    q.delete('id');
    if (next === 'solutions') q.delete('tab'); else q.set('tab', next);
    setParams(q, { replace: true });
  };

  return (
    <div className="min-h-full bg-background">
      <PageHeader
        title="Organisation & Solutions"
        subtitle="The people you share with, and the problems already solved"
        icon={Building2}
      />
      <div className="px-4 pt-6 md:px-8">
        <div className="flex gap-1" role="tablist" aria-label="Section">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => pick(id)}
              className={cn('inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] transition-colors',
                tab === id ? 'border-primary/40 bg-primary/10 font-medium' : 'border-border/60 text-muted-foreground hover:text-foreground')}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'organisation'
        ? <div className="px-4 py-6 md:px-8"><OrganizationTab /></div>
        : <SolutionsLibrary />}
    </div>
  );
}

function SolutionsLibrary() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const { data: orgData } = useQuery({ queryKey: ['orgs'], queryFn: orgsService.list });
  const orgs = useMemo(() => orgData?.orgs ?? [], [orgData]);
  const [org, setOrg] = useState<number | null | undefined>(undefined);
  const scope = org === undefined ? (orgData?.active_org_id ?? null) : org;
  const openId = params.get('id') ? Number(params.get('id')) : null;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['solutions', scope, submitted],
    queryFn: () => solutionsService.list(scope, submitted),
    enabled: orgData !== undefined,
  });
  const items = data?.solutions ?? [];

  const open = (id: number | null) => {
    const next = new URLSearchParams(params);
    if (id == null) next.delete('id'); else next.set('id', String(id));
    setParams(next, { replace: true });
  };

  return (
    <div>
      <div className="px-4 py-6 md:px-8">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            value={scope ?? ''}
            onChange={(e) => {
              setOrg(e.target.value ? Number(e.target.value) : null);
              setSubmitted('');
              setQuery('');
              open(null);
            }}
            className="rounded border border-border bg-background px-2 py-1.5 text-sm"
            aria-label="Whose solutions"
          >
            <option value="">Just mine (no organisation)</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <form className="flex min-w-0 flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); setSubmitted(query); }}>
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Describe the problem or paste the error"
                className="w-full rounded border border-border bg-background py-1.5 pl-8 pr-2 text-sm" />
            </div>
            <button type="submit" className="rounded bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground">Search</button>
          </form>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div>
            {isLoading && <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
            {isError && <p className="py-10 text-center text-sm text-muted-foreground">Solutions could not be loaded.</p>}
            {!isLoading && !isError && items.length === 0 && (
              <p className="mx-auto max-w-md py-12 text-center text-sm leading-relaxed text-muted-foreground">
                {submitted
                  ? 'No saved solution matches that. If you solve it, say "that worked" in chat and it will be saved here.'
                  : 'Nothing saved yet. When a fix works in chat — say "that worked" or give it a thumbs up — it is saved here.'}
              </p>
            )}
            <ul className="space-y-2">
              {items.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => open(s.id)}
                    className={cn('w-full rounded-lg border p-3 text-left transition-colors',
                      openId === s.id ? 'border-primary/50 bg-primary/5' : 'border-border/60 bg-card/60 hover:bg-secondary/50')}>
                    <p className="text-sm font-medium">{s.problem}</p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {s.solved_by} · {s.solved_on} · worked for {s.track_record.worked}
                    </p>
                    <div className="mt-1.5"><Badges s={s} /></div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="lg:sticky lg:top-4 lg:self-start">
            {openId != null ? (
              <div className="rounded-lg border border-border/60 bg-card/40 p-4">
                <Detail org={scope} id={openId} onClose={() => open(null)} />
              </div>
            ) : (
              <p className="hidden py-12 text-center text-sm text-muted-foreground lg:block">Pick a solution to read it.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
