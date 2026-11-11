/**
 * Team knowledge — what your organisation has already solved, and what the
 * team's knowledge bases hold. Served at `/team`; `/solutions` opens the same page.
 *
 * Tabs (`?tab=`):
 *   library  — the solutions your organisation has solved; write, import or search
 *              them here. Filters: `?attention=1` (needs attention), `?tag=`,
 *              `?mine=1` (only the ones you wrote). Shows the team documents too.
 *   drafts   — fixes a chat found for you, waiting for you to share or discard;
 *   queue    — curators only: what is waiting for a curator's decision;
 *   insights — curators only: what the team searched for and what it found;
 *   team     — the organisation's people and settings, and the knowledge bases
 *              you share with it.
 *
 * Scope is `?org=<id>` or `?org=personal`. Notification links carry it, so a
 * link opens the solution in the organisation it belongs to. Without it, the
 * organisation the viewer has active is used. A solution is opened with `?id=`.
 *
 * Saved solutions are written by the assistant when a fix works, or by hand.
 * Each claim in a fix says how fast it goes stale; a claim past its window is
 * marked "check", and the assistant must re-verify it before relying on it.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  BarChart3,
  Building2,
  ClipboardCheck,
  Lightbulb,
  Pencil,
  Plus,
  Search,
  Upload,
  Users,
  type LucideIcon,
} from 'lucide-react';

import orgsService, { CURATOR_ROLES, type Org } from '../api/orgs';
import solutionsService, {
  type DraftFields,
  type Solution,
  type SolutionListStatus,
} from '../api/solutions';
import PageHeader from '../components/layout/PageHeader';
import KnowledgeBaseSharing from '../components/documents/KnowledgeBaseSharing';
import OrganizationTab from '../components/settings/OrganizationTab';
import DocumentImportDialog from '../components/solutions/DocumentImportDialog';
import LibraryEmptyState from '../components/solutions/LibraryEmptyState';
import SolutionDetail from '../components/solutions/SolutionDetail';
import SolutionForm from '../components/solutions/SolutionForm';
import SolutionInsights from '../components/solutions/SolutionInsights';
import SolutionRow from '../components/solutions/SolutionRow';
import TeamDocuments from '../components/solutions/TeamDocuments';
import { markLeaving, restoreRows, type ListRow } from '../components/solutions/rowExit';
import { Button } from '../components/ui/Button';
import { SkeletonList } from '../components/ui/Skeleton';
import { detailOf, emptyValues } from '../lib/solutionForm';
import {
  cleanTag,
  flagOn,
  isCuratorTab,
  nextPageParam,
  openIdOf,
  paramOfScope,
  scopeOfParam,
  teamTabOf,
  visibleTabs,
  type TeamTab,
} from '../lib/solutionsPage';
import { toast } from '../lib/toastStore';
import { cn } from '../lib/utils';

type WorkTab = Extract<TeamTab, 'library' | 'drafts' | 'queue'>;

/** Every solutions query starts with `solutions`, so one invalidation refreshes them all. */
const ROOT = 'solutions';

/** The tab icons, labels and counts. Queue and insights appear for curators only. */
const TAB_META: Record<TeamTab, { label: string; icon: LucideIcon }> = {
  library: { label: 'Library', icon: Lightbulb },
  drafts: { label: 'My drafts', icon: Pencil },
  queue: { label: 'Review queue', icon: ClipboardCheck },
  insights: { label: 'Insights', icon: BarChart3 },
  team: { label: 'Team', icon: Users },
};

/** A count query: one per (scope, status), used for the tab badges. */
function countKey(scope: number | null, status: SolutionListStatus): QueryKey {
  return [ROOT, 'count', scope, status];
}

export default function TeamKnowledge() {
  const [params, setParams] = useSearchParams();
  const { data: orgData } = useQuery({ queryKey: ['orgs'], queryFn: orgsService.list });
  const ready = orgData !== undefined;
  const orgs = orgData?.orgs ?? [];
  const tab = teamTabOf(params.get('tab'));

  // A deep link names its scope. An organisation the viewer is not in cannot be
  // honoured, so the active one is used and the page says so.
  const urlScope = scopeOfParam(params.get('org'));
  const urlHonoured = urlScope !== undefined
    && (urlScope === null || !ready || orgs.some((o) => o.id === urlScope));
  const scope: number | null = urlHonoured ? (urlScope as number | null) : (orgData?.active_org_id ?? null);
  const notMember = ready && urlScope != null && !orgs.some((o) => o.id === urlScope);

  const scopeOrg: Org | undefined = orgs.find((o) => o.id === scope);
  const canCurate = !!scopeOrg && CURATOR_ROLES.includes(scopeOrg.role);

  const draftCount = useQuery({
    queryKey: countKey(scope, 'draft'),
    queryFn: () => solutionsService.list(scope, { status: 'draft' }),
    enabled: ready,
  });
  const queueCount = useQuery({
    queryKey: countKey(scope, 'pending_review'),
    queryFn: () => solutionsService.list(scope, { status: 'pending_review' }),
    enabled: ready && canCurate,
  });

  const tabs = visibleTabs(canCurate).map((id) => ({
    id,
    ...TAB_META[id],
    count: id === 'drafts' ? draftCount.data?.total : id === 'queue' ? queueCount.data?.total : undefined,
  }));

  /** Changing tab keeps the scope and drops the open solution and the library-only filters. */
  const pick = (next: TeamTab) => {
    const q = new URLSearchParams(params);
    q.delete('id');
    q.set('tab', next);
    if (next !== 'library') {
      q.delete('attention');
      q.delete('tag');
      q.delete('mine');
    }
    setParams(q, { replace: true });
  };

  const pickScope = (next: number | null) => {
    const q = new URLSearchParams(params);
    q.delete('id');
    q.set('org', paramOfScope(next));
    setParams(q, { replace: true });
  };

  /** The address of a solution in the library, in the scope the page is showing. */
  const hrefFor = (id: number) => {
    const q = new URLSearchParams(params);
    q.set('tab', 'library');
    q.set('org', paramOfScope(scope));
    q.set('id', String(id));
    q.delete('attention');
    return `?${q.toString()}`;
  };

  const curatorOnly = isCuratorTab(tab) && ready && !canCurate;

  return (
    <div className="min-h-full bg-background">
      <PageHeader
        title="Team knowledge"
        subtitle="The problems your team has already solved, and the documents it shares"
        icon={Building2}
      />
      <div className="px-4 pt-6 md:px-8">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Section">
          {tabs.map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`solutions-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="solutions-panel"
              onClick={() => pick(id)}
              className={cn(
                'relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-1.5 text-[13px] transition-colors duration-normal ease-standard',
                tab === id
                  ? 'border-primary/40 bg-primary/10 font-medium'
                  : 'border-border/60 text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
              {count != null && count > 0 && (
                <span className="rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary tabular-nums">
                  {count}
                </span>
              )}
              {/* The active underline grows in and shrinks out on transform alone (no layout). */}
              <span
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute inset-x-2 -bottom-1 h-0.5 rounded-full bg-primary transition-transform duration-normal ease-decelerate',
                  tab === id ? 'scale-x-100' : 'scale-x-0',
                )}
              />
            </button>
          ))}
        </div>
      </div>

      {notMember && (
        <p role="status" className="px-4 pt-4 text-[13px] text-muted-foreground md:px-8">
          That organisation is not one you belong to, so this shows your active organisation.
        </p>
      )}

      <div id="solutions-panel" role="tabpanel" aria-labelledby={`solutions-tab-${tab}`}>
        {curatorOnly ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground md:px-8">
            {tab === 'insights'
              ? 'Only the curators of this organisation see the insights.'
              : 'Only the curators of this organisation see the review queue.'}
          </p>
        ) : tab === 'team' ? (
          <div key={tab} className="animate-fade-in space-y-10 px-4 py-6 md:px-8">
            <OrganizationTab />
            <section aria-labelledby="team-documents-heading" className="space-y-3">
              <h2 id="team-documents-heading" className="text-base font-medium">Team documents</h2>
              <p className="text-[13px] text-muted-foreground">
                A knowledge base you own can be shared with an organisation you belong to. Its members can search it from
                chat. They cannot upload to it or delete from it.
              </p>
              <KnowledgeBaseSharing orgs={orgs} />
            </section>
          </div>
        ) : tab === 'insights' ? (
          <div key={tab} className="animate-fade-in px-4 py-6 md:px-8">
            {scopeOrg ? (
              <SolutionInsights org={scopeOrg.id} orgName={scopeOrg.name} hrefFor={hrefFor} />
            ) : null}
          </div>
        ) : (
          <SolutionsWorkspace
            key={String(scope)}
            tab={tab as WorkTab}
            scope={scope}
            scopeOrg={scopeOrg}
            canCurate={canCurate}
            ready={ready}
            orgs={orgs}
            onScope={pickScope}
          />
        )}
      </div>
    </div>
  );
}

/** The list-and-detail view for the library, the drafts and the queue. */
function SolutionsWorkspace({
  tab,
  scope,
  scopeOrg,
  canCurate,
  ready,
  orgs,
  onScope,
}: {
  tab: WorkTab;
  scope: number | null;
  scopeOrg: Org | undefined;
  canCurate: boolean;
  ready: boolean;
  orgs: Org[];
  onScope: (next: number | null) => void;
}) {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  /** The row whose "Edit" was pressed: its detail opens already in the edit form. */
  const [editRequest, setEditRequest] = useState<number | null>(null);

  const isLibrary = tab === 'library';
  const attention = isLibrary && flagOn(params.get('attention'));
  const mine = isLibrary && flagOn(params.get('mine'));
  const tag = isLibrary ? cleanTag(params.get('tag')) : '';
  const status: SolutionListStatus | undefined =
    tab === 'drafts' ? 'draft' : tab === 'queue' ? 'pending_review' : undefined;
  // The attention view ignores search and status on the server, so it is shown without them.
  const search = isLibrary && !attention ? submitted : '';
  const openId = openIdOf(params.get('id'));
  const listEnabled = ready && (tab !== 'queue' || canCurate);

  const pages = useInfiniteQuery({
    queryKey: [ROOT, 'pages', scope, status ?? 'library', search, tag, mine, attention],
    queryFn: ({ pageParam }) =>
      solutionsService.list(scope, { q: search, status, tag, mine, attention, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: nextPageParam,
    enabled: listEnabled,
  });
  const items: ListRow[] = pages.data?.pages.flatMap((p) => p.solutions) ?? [];
  const lastPage = pages.data ? pages.data.pages[pages.data.pages.length - 1] : undefined;
  const attentionCut = attention && lastPage?.truncated === true;
  const tagCapped = lastPage?.tag_scan_capped === true;

  /** The count on the "Needs attention" chip, under the same tag and "mine" filters as the list. */
  const attentionCount = useQuery({
    queryKey: [ROOT, 'attention', scope, tag, mine],
    queryFn: () => solutionsService.list(scope, { attention: true, tag, mine }),
    enabled: listEnabled && isLibrary,
  });

  const setParam = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(updates)) {
      if (value == null) next.delete(key); else next.set(key, value);
    }
    setParams(next, { replace: true });
  };

  const open = (id: number | null) => {
    const next = new URLSearchParams(params);
    if (id == null) next.delete('id'); else next.set('id', String(id));
    setParams(next, { replace: true });
  };

  /** A row opened normally: its detail is not in the edit form. */
  const openRow = (id: number) => {
    setEditRequest(null);
    open(id);
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: [ROOT] });

  const create = useMutation({
    mutationFn: ({ draft, share }: { draft: DraftFields; share: boolean }) =>
      solutionsService.create(scope, draft, share),
    onSuccess: (saved) => {
      setCreating(false);
      setCreateError(null);
      void invalidate();
      toast.success('Saved.');
      open(saved.id);
    },
    onError: (e) => setCreateError(detailOf(e, 'Could not save the solution.')),
  });

  // Both leave the attention view, so the row collapses at once and is rolled back if the write fails.
  const stillTrue = useMutation({
    mutationFn: (s: Solution) => solutionsService.review(scope, s.id, 'verified', ''),
    onMutate: (s) => markLeaving(qc, s.id),
    onSuccess: () => {
      toast.success('Marked as still true.');
      void invalidate();
    },
    onError: (e, _vars, snapshot) => {
      if (snapshot) restoreRows(qc, snapshot);
      toast.error(detailOf(e, 'Could not record that.'));
    },
  });

  const retract = useMutation({
    mutationFn: (id: number) => solutionsService.retract(scope, id),
    onMutate: (id) => markLeaving(qc, id),
    onSuccess: (_result, id) => {
      if (openId === id) open(null);
      toast.success('Removed.');
      void invalidate();
    },
    onError: (e, _vars, snapshot) => {
      if (snapshot) restoreRows(qc, snapshot);
      toast.error(detailOf(e, 'Could not remove it.'));
    },
  });

  const rowBusy = stillTrue.isPending || retract.isPending;

  const emptyText = tab === 'drafts'
    ? 'No drafts. When a fix is found in a team chat, its draft waits here for you to share or discard.'
    : tab === 'queue'
      ? 'Nothing is waiting for review.'
      : attention
        ? 'Nothing needs attention right now.'
        : submitted || tag || mine
          ? 'No saved solution matches these filters.'
          : '';

  const showCards = isLibrary && !attention && !submitted && !tag && !mine;
  const emptyCards = showCards && ready && !pages.isLoading && !pages.isError && items.length === 0;

  return (
    <div className="px-4 py-6 md:px-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={scope ?? ''}
          onChange={(e) => onScope(e.target.value ? Number(e.target.value) : null)}
          className="rounded border border-border bg-background px-2 py-1.5 text-sm"
          aria-label="Whose solutions"
        >
          <option value="">Just mine (no organisation)</option>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>

        {isLibrary && !attention && (
          <form
            className="flex min-w-[12rem] flex-1 gap-2"
            role="search"
            onSubmit={(e) => { e.preventDefault(); setSubmitted(query); }}
          >
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Describe the problem or paste the error"
                aria-label="Search solutions"
                className="w-full rounded border border-border bg-background py-1.5 pl-8 pr-2 text-sm"
              />
            </div>
            <Button type="submit" size="sm">Search</Button>
          </form>
        )}

        {isLibrary && (
          <>
            <Button size="sm" variant="secondary" onClick={() => { setCreating((v) => !v); setCreateError(null); }} aria-expanded={creating}>
              <Plus className="h-3.5 w-3.5" /> New solution
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>
              <Upload className="h-3.5 w-3.5" /> Import from a document
            </Button>
          </>
        )}
      </div>

      {isLibrary && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[12px]">
          <button
            type="button"
            aria-pressed={attention}
            onClick={() => setParam({ attention: attention ? null : '1' })}
            className={cn(
              'rounded-full border px-2.5 py-1 transition-colors',
              attention
                ? 'border-amber-500/50 bg-amber-500/15 font-medium text-amber-700 dark:text-amber-300'
                : 'border-border/60 text-muted-foreground hover:text-foreground',
            )}
          >
            Needs attention{attentionCount.data?.total != null ? ` (${attentionCount.data.total})` : ''}
          </button>
          <button
            type="button"
            aria-pressed={mine}
            onClick={() => setParam({ mine: mine ? null : '1' })}
            className={cn(
              'rounded-full border px-2.5 py-1 transition-colors',
              mine ? 'border-primary/40 bg-primary/10 font-medium' : 'border-border/60 text-muted-foreground hover:text-foreground',
            )}
          >
            Only mine
          </button>
          {tag && (
            <button
              type="button"
              onClick={() => setParam({ tag: null })}
              aria-label={`Clear the tag filter ${tag}`}
              className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 font-medium"
            >
              Tagged {tag} ×
            </button>
          )}
        </div>
      )}

      {isLibrary && creating && (
        <section aria-label="New solution" className="mb-6 rounded-lg border border-border/60 bg-card/40 p-4">
          <h3 className="mb-3 text-base font-medium">New solution</h3>
          <SolutionForm
            mode="new"
            initial={emptyValues()}
            shareOption={scope != null}
            orgName={scopeOrg?.name}
            submitLabel="Save solution"
            busy={create.isPending}
            serverError={createError}
            onSubmit={(draft, options) => create.mutate({ draft, share: options.share })}
            onCancel={() => { setCreating(false); setCreateError(null); }}
          />
        </section>
      )}

      {isLibrary && importing && (
        <DocumentImportDialog org={scope} onClose={() => setImporting(false)} />
      )}

      {/* With an empty library the start cards take the full width: a reading
          pane beside them has nothing to show and squeezes the cards. */}
      <div className={cn(
        'grid gap-4',
        !(emptyCards && openId == null) && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]',
      )}>
        {/* Keyed on the tab: switching tabs fades the list in and replays the row stagger. */}
        <div key={tab} className="min-w-0 animate-fade-in">
          {(pages.isLoading || !ready) && <SkeletonList rows={4} label="Loading solutions" />}
          {pages.isError && <p className="py-10 text-center text-sm text-muted-foreground">Solutions could not be loaded.</p>}

          {!pages.isLoading && !pages.isError && ready && items.length === 0 && (
            isLibrary && showCards ? (
              <LibraryEmptyState
                hasOrg={orgs.length > 0}
                onWrite={() => { setCreating(true); setCreateError(null); }}
                onImport={() => setImporting(true)}
                teamHref="?tab=team"
              />
            ) : (
              <p className="mx-auto max-w-md py-12 text-center text-sm leading-relaxed text-muted-foreground">{emptyText}</p>
            )
          )}

          {attentionCut && (
            <p className="mb-2 text-[12px] text-muted-foreground">
              Only the first 500 solutions were checked. Older ones are not in this list.
            </p>
          )}
          {tagCapped && (
            <p className="mb-2 text-[12px] text-muted-foreground">
              This tag was searched among the newest solutions only. Older matches may be missing.
            </p>
          )}

          <ul className="stagger-children space-y-2">
            {items.map((s) => (
              <SolutionRow
                key={s.id}
                s={s}
                selected={openId === s.id}
                attentionView={attention}
                leaving={s.leaving}
                busy={rowBusy}
                onOpen={openRow}
                onTag={(t) => setParam({ tag: t })}
                onStillTrue={(row) => stillTrue.mutate(row)}
                onEdit={(row) => { setEditRequest(row.id); open(row.id); }}
                onRetract={(row) => retract.mutate(row.id)}
              />
            ))}
          </ul>

          {pages.hasNextPage && (
            <div className="pt-3">
              <Button
                variant="secondary"
                size="sm"
                loading={pages.isFetchingNextPage}
                onClick={() => void pages.fetchNextPage()}
              >
                Load more
              </Button>
            </div>
          )}
        </div>

        <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          {openId != null ? (
            <div className="rounded-lg border border-border/60 bg-card/40 p-4">
              <SolutionDetail
                key={`${openId}:${editRequest === openId ? 'edit' : 'view'}`}
                org={scope}
                orgName={scopeOrg?.name}
                id={openId}
                canCurate={canCurate}
                startEditing={editRequest === openId}
                onClose={() => open(null)}
              />
            </div>
          ) : emptyCards ? null : (
            <p className="hidden py-12 text-center text-sm text-muted-foreground lg:block">Pick a solution to read it.</p>
          )}
        </div>
      </div>

      {isLibrary && scopeOrg && (
        <div className="mt-10">
          <TeamDocuments org={scopeOrg.id} />
        </div>
      )}
    </div>
  );
}
