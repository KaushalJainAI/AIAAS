/**
 * `/pages` — the pages you published, and the ones listed on the platform.
 *
 * Publishing happens in a conversation or an agent run (`publish_page`); this
 * is where a person sees what is out there under their name and takes it down.
 * Withdrawing unlists — the link stops resolving, nothing is deleted — so the
 * button says "Withdraw", not "Delete".
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, FileText, Globe, Link2, Loader2, Users } from 'lucide-react';

import pagesService, { type PageVisibility, type PublishedPage } from '../api/pages';
import PageHeader from '../components/layout/PageHeader';
import { toast } from '../lib/toastStore';
import { cn } from '../lib/utils';

const VISIBILITY: Record<PageVisibility, { label: string; icon: typeof Globe }> = {
  link: { label: 'Anyone with the link', icon: Link2 },
  platform: { label: 'Everyone on the platform', icon: Users },
  public: { label: 'Public', icon: Globe },
};

export default function Pages() {
  const [scope, setScope] = useState<'mine' | 'platform'>('mine');
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['published-pages', scope],
    queryFn: () => pagesService.list(scope === 'platform' ? 'platform' : undefined),
  });
  const withdraw = useMutation({
    mutationFn: (slug: string) => pagesService.withdraw(slug),
    onSuccess: () => {
      toast.success('Page withdrawn — its link no longer opens.');
      qc.invalidateQueries({ queryKey: ['published-pages'] });
    },
    onError: () => toast.error('Could not withdraw that page.'),
  });

  const copy = async (slug: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/p/${slug}`);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link.');
    }
  };

  const pages = data?.results ?? [];
  return (
    <div className="min-h-full bg-background">
      <PageHeader
        title="Pages"
        subtitle="Reports, pages and files you published, shareable by link"
        icon={Globe}
      />
      <div className="px-4 py-6 md:px-8">
        <div className="mb-4 flex gap-1" role="tablist" aria-label="Which pages">
          {(['mine', 'platform'] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={scope === s} onClick={() => setScope(s)}
              className={cn('rounded-md border px-3 py-1.5 text-[13px] transition-colors',
                scope === s ? 'border-primary/40 bg-primary/10 font-medium' : 'border-border/60 text-muted-foreground hover:text-foreground')}>
              {s === 'mine' ? 'Yours' : 'On the platform'}
            </button>
          ))}
        </div>

        {isLoading && <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
        {isError && <p className="py-10 text-center text-sm text-muted-foreground">Pages could not be loaded.</p>}
        {!isLoading && !isError && pages.length === 0 && (
          <p className="mx-auto max-w-md py-12 text-center text-sm leading-relaxed text-muted-foreground">
            {scope === 'mine'
              ? 'Nothing published yet. Ask in chat — "publish this report as a page" — and it will appear here.'
              : 'Nobody has listed a page on the platform yet.'}
          </p>
        )}

        <ul className="m-0 list-none space-y-2 p-0">
          {pages.map((p) => <PageRow key={p.slug} page={p} onCopy={copy}
            onWithdraw={p.is_mine && p.is_listed ? () => withdraw.mutate(p.slug) : undefined} />)}
        </ul>
      </div>
    </div>
  );
}

function PageRow({ page, onCopy, onWithdraw }: {
  page: PublishedPage; onCopy: (slug: string) => void; onWithdraw?: () => void;
}) {
  const vis = VISIBILITY[page.visibility ?? 'platform'];
  const Icon = vis.icon;
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-3">
      <FileText className="h-4 w-4 shrink-0 text-primary/80" />
      <div className="min-w-0 flex-1">
        <Link to={`/p/${page.slug}`} className="block truncate text-sm font-medium text-foreground hover:text-primary">
          {page.title}
        </Link>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Icon className="h-3 w-3" />
          {page.is_listed === false ? 'Withdrawn' : vis.label} · {page.kind} · {new Date(page.updated_at).toLocaleDateString()}
        </span>
      </div>
      <button type="button" onClick={() => onCopy(page.slug)} title="Copy link"
        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Copy link to ${page.title}`}>
        <Copy className="h-3.5 w-3.5" />
      </button>
      <Link to={`/p/${page.slug}`} target="_blank" rel="noreferrer" title="Open"
        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Open ${page.title}`}>
        <ExternalLink className="h-3.5 w-3.5" />
      </Link>
      {onWithdraw && (
        <button type="button" onClick={onWithdraw}
          className="rounded-md border border-border/60 px-2 py-1 text-[12px] text-muted-foreground hover:border-destructive/40 hover:text-destructive">
          Withdraw
        </button>
      )}
    </li>
  );
}
