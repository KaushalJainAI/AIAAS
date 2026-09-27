/**
 * `/dashboards` — live dashboards: KPI / chart / table / text tiles.
 *
 * Saved by agents (`save_dashboard`) or chat; refreshed here without an LLM
 * call. Tiles render from data (`ChartArtifact` owns every visual decision),
 * never from model-authored markup.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, Loader2, RefreshCw, Trash2 } from 'lucide-react';

import dashboardsService, { type Dashboard } from '../api/dashboards';
import ChartArtifact from '../components/chat/ChartArtifact';
import MarkdownMessage from '../components/chat/MarkdownMessage';
import PageHeader from '../components/layout/PageHeader';
import { toast } from '../lib/toastStore';
import { cn } from '../lib/utils';

export default function Dashboards() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<number | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboards'],
    queryFn: () => dashboardsService.list(),
  });

  const refresh = useMutation({
    mutationFn: (id: number) => dashboardsService.refresh(id),
    onSuccess: () => {
      toast.success('Dashboard refreshed.');
      qc.invalidateQueries({ queryKey: ['dashboards'] });
    },
    onError: () => toast.error('Could not refresh that dashboard.'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => dashboardsService.remove(id),
    onSuccess: () => {
      toast.success('Dashboard deleted.');
      setOpenId(null);
      qc.invalidateQueries({ queryKey: ['dashboards'] });
    },
    onError: () => toast.error('Could not delete that dashboard.'),
  });

  const rows = data?.results ?? [];
  const open = rows.find((d) => d.id === openId) ?? null;

  return (
    <div className="min-h-full bg-background">
      <PageHeader
        title="Dashboards"
        subtitle="Live tiles — ask in chat to build one, refresh it here"
        icon={LayoutDashboard}
      />
      <div className="px-4 py-6 md:px-8">
        {isLoading && <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
        {isError && <p className="py-10 text-center text-sm text-muted-foreground">Dashboards could not be loaded.</p>}
        {!isLoading && !isError && rows.length === 0 && (
          <p className="mx-auto max-w-md py-12 text-center text-sm leading-relaxed text-muted-foreground">
            Nothing here yet. Ask in chat — "track MRR and churn on a dashboard" — and it will appear here.
          </p>
        )}
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => setOpenId(d.id)}
                className={cn(
                  'block w-full rounded-lg border border-border/60 bg-card p-4 text-left hover:border-border-strong',
                  openId === d.id && 'border-primary/40',
                )}
              >
                <span className="block truncate text-sm font-semibold">{d.title}</span>
                <span className="mt-0.5 block text-[12px] text-muted-foreground">
                  {d.spec.tiles.length} {d.spec.tiles.length === 1 ? 'tile' : 'tiles'}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {open && (
          <div className="mt-6 rounded-lg border border-border/60 bg-card p-4">
            <div className="mb-4 flex items-center gap-2">
              <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{open.title}</h2>
              <button
                type="button"
                onClick={() => refresh.mutate(open.id)}
                disabled={refresh.isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5 text-[13px] hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', refresh.isPending && 'animate-spin')} /> Refresh
              </button>
              <button
                type="button"
                onClick={() => remove.mutate(open.id)}
                disabled={remove.isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5 text-[13px] text-destructive hover:bg-muted disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {open.spec.tiles.map((_, i) => <Tile key={i} dashboard={open} index={i} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ dashboard, index }: { dashboard: Dashboard; index: number }) {
  const t = dashboard.spec.tiles[index];
  if (!t) return null;
  if (t.kind === 'kpi') {
    return (
      <div className="rounded-lg border border-border/60 p-4">
        {t.title && <p className="text-[12px] text-muted-foreground">{t.title}</p>}
        <p className="mt-1 text-2xl font-bold">{t.value}</p>
        {t.delta && <p className="mt-0.5 text-[12px] text-muted-foreground">{t.delta}</p>}
      </div>
    );
  }
  if (t.kind === 'chart' && t.chart) {
    return (
      <div className="rounded-lg border border-border/60 p-3">
        <ChartArtifact chart={t.chart} />
      </div>
    );
  }
  if (t.kind === 'table') {
    return (
      <div className="overflow-x-auto rounded-lg border border-border/60 p-3">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>{(t.columns ?? []).map((c, i) => <th key={i} className="border-b border-border/60 px-2 py-1 text-left font-semibold">{c}</th>)}</tr>
          </thead>
          <tbody>
            {(t.rows ?? []).map((r, i) => (
              <tr key={i}>{r.map((v, j) => <td key={j} className="border-b border-border/40 px-2 py-1">{v}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border/60 p-4">
      {t.title && <p className="mb-1 text-sm font-semibold">{t.title}</p>}
      <MarkdownMessage content={t.text ?? ''} variant="full" />
    </div>
  );
}
