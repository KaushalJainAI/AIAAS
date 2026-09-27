/**
 * `/apps` — the launcher for the browser productivity apps.
 *
 * Every tile opens a real route: the workspace apps at `/apps/<id>` (the
 * user's matching files beside an editor) and the pages that already exist
 * (Files, Dashboards, Pages, Imagine).
 *
 * Two recent lists, because they answer different questions. "Jump back in"
 * is what the user *opened* (`api/recents.ts`), and reopens each file in the
 * app it was last used in. "Recently changed" is what was *edited*, by anyone
 * including an agent, since an agent's file is the user's file.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppWindow, Search, Sparkles, X } from 'lucide-react';

import { documentsService } from '../api/documents';
import { recentsService, type RecentFile } from '../api/recents';
import { useRecentFiles } from '../hooks/useRecents';
import PageHeader from '../components/layout/PageHeader';
import { acceptsDoc, defaultAppFor, getApp, openInAppPath, searchApps, type AppMeta } from '../lib/apps';
import { fileIcon, fileTint, formatDate, locationOf } from '../lib/fileDisplay';
import { cn } from '../lib/utils';

export default function Apps() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const apps = useMemo(() => searchApps(query), [query]);
  const workspace = apps.filter((a) => a.kind === 'workspace');
  const more = apps.filter((a) => a.kind === 'route');

  // One page of the user's latest files feeds both the counts on the tiles
  // and the Recent list, so the launcher costs one request.
  const { data } = useQuery({
    queryKey: ['documents', 'apps-launcher'],
    queryFn: () => documentsService.list({ limit: 100, scope: 'personal' }),
    staleTime: 60_000,
  });
  const files = useMemo(() => data?.my_documents ?? [], [data]);
  const recents = useMemo(
    () => [...files].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).filter((d) => defaultAppFor(d)).slice(0, 8),
    [files],
  );
  const opened = useRecentFiles({ limit: 8 });
  const openedRows = useMemo(
    () => (opened.data ?? []).filter((r) => defaultAppFor(r.document)),
    [opened.data],
  );
  const countFor = (app: AppMeta) => files.filter((d) => acceptsDoc(app, d)).length;
  const capped = !!data?.my_has_more;

  return (
    <div className="h-full overflow-auto bg-background">
      <PageHeader title="Apps" subtitle="Productivity apps that open your files — everything runs in your browser" icon={AppWindow} />
      <div className="px-4 py-6 md:px-8">
        <div className="mb-6 flex max-w-md items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search apps…"
            aria-label="Search apps"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        {!query && openedRows.length > 0 && <JumpBackIn rows={openedRows} />}

        {apps.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">No apps match that search.</p>
        )}

        {workspace.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold">Productivity</h2>
            <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
              {workspace.map((app) => {
                const n = countFor(app);
                return (
                  <AppTile
                    key={app.id}
                    app={app}
                    meta={n ? `${n}${capped ? '+' : ''} ${n === 1 ? 'file' : 'files'}` : 'No files yet'}
                    onAi={() => navigate(`/ai-chat?new=${encodeURIComponent(app.newPrompt)}`)}
                  />
                );
              })}
            </ul>
          </section>
        )}

        {more.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold">More</h2>
            <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
              {more.map((app) => (
                <AppTile key={app.id} app={app} meta={app.description} />
              ))}
            </ul>
          </section>
        )}

        {!query && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Recently changed</h2>
              <Link to="/documents" className="text-[12.5px] text-primary hover:underline">Open Files</Link>
            </div>
            {recents.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Nothing yet — files you create, upload, or ask an agent to make will appear here.
              </p>
            ) : (
              <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 xl:grid-cols-4">
                {recents.map((d) => {
                  const app = defaultAppFor(d)!;
                  const Icon = fileIcon(d);
                  return (
                    <li key={d.id}>
                      <Link
                        to={openInAppPath(d, app)!}
                        className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-2.5 no-underline hover:border-primary/40"
                      >
                        <Icon className={cn('h-5 w-5 shrink-0', fileTint(d))} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-foreground">{d.filename}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {app.title} · {locationOf(d)} · {formatDate(d.updated_at)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/** The app a recent file reopens in: the one it was last used in, if it can. */
function appForRecent(row: RecentFile): AppMeta {
  const last = getApp(row.app);
  return last && last.kind === 'workspace' && acceptsDoc(last, row.document) ? last : defaultAppFor(row.document)!;
}

function JumpBackIn({ rows }: { rows: RecentFile[] }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['recents', 'list'] });
  const forget = (id: number) => void recentsService.forget(id).then(refresh).catch(() => undefined);
  const clear = () => void recentsService.clear().then(refresh).catch(() => undefined);
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Jump back in</h2>
        <button type="button" onClick={clear} className="text-[12.5px] text-muted-foreground hover:text-foreground">
          Clear
        </button>
      </div>
      <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((row) => {
          const d = row.document;
          const app = appForRecent(row);
          const Icon = fileIcon(d);
          return (
            <li key={d.id} className="group relative">
              <Link
                to={openInAppPath(d, app)!}
                className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-2.5 pr-8 no-underline hover:border-primary/40"
              >
                <Icon className={cn('h-5 w-5 shrink-0', fileTint(d))} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-foreground">{d.filename}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {app.title} · opened {formatDate(row.opened_at)}
                  </span>
                </span>
              </Link>
              <button
                type="button"
                onClick={() => forget(d.id)}
                aria-label={`Remove ${d.filename} from recent`}
                title="Remove from recent"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-70 hover:bg-muted hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AppTile({ app, meta, onAi }: { app: AppMeta; meta: string; onAi?: () => void }) {
  const Icon = app.icon;
  return (
    <li className="group relative flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card transition-colors hover:border-primary/40">
      <Link to={app.path} className="flex flex-1 flex-col items-start gap-2 p-4 no-underline">
        <span className={cn('inline-flex rounded-xl bg-gradient-to-br p-2.5 text-white shadow-sm', app.tint)}>
          <Icon className="h-5 w-5" />
        </span>
        <span className="block text-sm font-semibold text-foreground">{app.title}</span>
        <span className="line-clamp-2 block text-[12px] leading-snug text-muted-foreground">
          {app.kind === 'workspace' ? app.description : meta}
        </span>
        {app.kind === 'workspace' && <span className="mt-auto pt-1 text-[11px] text-muted-foreground/80">{meta}</span>}
      </Link>
      {onAi && (
        <button
          type="button"
          onClick={onAi}
          title={app.newPrompt}
          aria-label={`New ${app.title} file with AI`}
          className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground opacity-70 hover:bg-muted hover:text-primary sm:opacity-0 sm:group-hover:opacity-100"
        >
          <Sparkles className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}
