/**
 * `/apps/:appId` — one productivity app, full-screen.
 *
 * Runs inside `AppFrame` (no site Topbar/Sidebar/BottomNav) under an `AppBar`
 * (home, app switcher, File menu, save status). The left file list is a
 * collapsible panel — a drawer on phones — with its state remembered; open
 * files are tabs kept per app in `sessionStorage`, with `?file=<id>` as the
 * active tab; version history slides in from the right.
 *
 * Leaving a dirty file — switching files, tabs, or closing a tab — goes
 * through the in-app unsaved-changes dialog (Save / Don't save / Cancel),
 * never the browser's `window.confirm`. Editors register their `save()`
 * through `SaveContext`, so the dialog saves whichever editor is mounted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown, Loader2, Plus, Search, Sparkles, Upload, X,
} from 'lucide-react';

import { documentsService, type Document } from '../api/documents';
import AppBar from '../components/apps/AppBar';
import AppEditor from '../components/apps/AppEditor';
import { Whiteboard } from '../components/apps/MediaEditors';
import NameDialog from '../components/apps/NameDialog';
import UnsavedDialog from '../components/apps/UnsavedDialog';
import VersionHistoryPanel from '../components/apps/VersionHistoryPanel';
import { useSave } from '../components/apps/useSave';
import { useAppTabs } from '../hooks/useAppTabs';
import { useRecentFiles, useRecordOpen } from '../hooks/useRecents';
import { acceptsDoc, getApp, type AppMeta, type NewFileOption } from '../lib/apps';
import { apiErrorMessage } from '../lib/apiError';
import { fileIcon, formatDate, formatSize, locationOf } from '../lib/fileDisplay';
import { toast } from '../lib/toastStore';
import { cn } from '../lib/utils';
import '../components/apps/appPrint.css';

const PAGE = 100;
const PRIMARY_BTN =
  'inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90';

function panelKey(appId: string) {
  return `app-panel:${appId}`;
}

export default function AppWorkspace() {
  const { appId } = useParams();
  const app = getApp(appId);
  if (!app) return <Navigate to="/apps" replace />;
  if (app.kind === 'route') return <Navigate to={app.path} replace />;
  return <Workspace key={app.id} app={app} />;
}

interface PendingNav {
  action: () => void;
  filename: string;
}

function Workspace({ app }: { app: AppMeta }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const fileParam = params.get('file');
  const blankBoard = app.editor === 'whiteboard' && fileParam === 'new';
  const selectedId = fileParam && !blankBoard ? Number(fileParam) || null : null;

  const [query, setQuery] = useState('');
  const [newMenu, setNewMenu] = useState(false);
  const [naming, setNaming] = useState<NewFileOption | null>(null);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pending, setPending] = useState<PendingNav | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [panelOpen, setPanelOpen] = useState(() => {
    try {
      return localStorage.getItem(panelKey(app.id)) !== '0';
    } catch {
      return true;
    }
  });
  const uploadInput = useRef<HTMLInputElement>(null);
  const saveCtx = useSave();
  // Mirrored for the navigation guard and `beforeunload`, which read it from
  // callbacks outside render.
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = saveCtx.dirty;
  }, [saveCtx.dirty]);

  const files = useInfiniteQuery({
    queryKey: ['app-files', app.id],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      documentsService.list({ scope: 'personal', limit: PAGE, cursor: pageParam, types: app.accepts!.types.join(',') }),
    getNextPageParam: (last) => (last.has_more ? last.next_cursor : undefined),
    staleTime: 30_000,
  });

  const all = useMemo(() => {
    const seen = new Set<number>();
    return (files.data?.pages.flatMap((p) => p.my_documents) ?? [])
      .filter((d) => acceptsDoc(app, d) && !seen.has(d.id) && seen.add(d.id))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [files.data, app]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? all.filter((d) => d.filename.toLowerCase().includes(needle) || (d.folder_path ?? '').toLowerCase().includes(needle)) : all;
  }, [all, query]);

  // The open file: from the list when it is there, fetched when it is not
  // (a deep link to a file past the first page, or one just created).
  const listed = all.find((d) => d.id === selectedId) ?? null;
  const { data: fetched, isError: missing } = useQuery({
    queryKey: ['documents', 'detail', selectedId],
    queryFn: () => documentsService.get(selectedId!),
    enabled: selectedId !== null && !listed,
    retry: false,
  });
  const selected = listed ?? (fetched && fetched.id === selectedId ? fetched : null);

  const { tabs, close, restoredActive } = useAppTabs(
    app.id,
    selected ? { id: selected.id, name: selected.filename } : null,
  );

  // Every file shown here counts as opened, and the app reopens where it was
  // left: when the URL names no file, the one in front last time comes back.
  useRecordOpen(selected?.id ?? null, app.id);
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || restoredActive === null) return;
    restored.current = true;
    if (fileParam !== null) return;
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('file', String(restoredActive));
      return next;
    }, { replace: true });
  }, [restoredActive, fileParam, setParams]);

  const recentOpened = useRecentFiles({ types: app.accepts!.types, limit: 20 });
  const recent = useMemo(() => {
    const opened = (recentOpened.data ?? []).map((r) => r.document).filter((d) => acceptsDoc(app, d));
    return opened.length > 0
      ? { label: 'Recently opened', docs: opened.slice(0, 6) }
      : { label: 'Recently changed', docs: all.slice(0, 6) };
  }, [recentOpened.data, all, app]);

  // A file open from a tab whose row has not loaded yet still labels the tab.
  const tabName = (id: number) =>
    all.find((d) => d.id === id)?.filename ?? tabs.find((t) => t.id === id)?.name ?? `File ${id}`;

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const togglePanel = useCallback(() => {
    setPanelOpen((prev) => {
      try {
        localStorage.setItem(panelKey(app.id), prev ? '0' : '1');
      } catch {
        // The panel still toggles; it just is not remembered.
      }
      return !prev;
    });
  }, [app.id]);

  const gotoFile = useCallback(
    (doc: Document | 'new' | null) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (doc === null) next.delete('file');
        else next.set('file', doc === 'new' ? 'new' : String(doc.id));
        return next;
      });
    },
    [setParams],
  );

  const gotoId = useCallback(
    (id: number | null) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (id === null) next.delete('file');
        else next.set('file', String(id));
        return next;
      });
    },
    [setParams],
  );

  /** Through the dialog when dirty, straight through when clean. */
  const requestNav = useCallback(
    (action: () => void) => {
      if (dirtyRef.current && selected) {
        setPending({ action, filename: selected.filename });
        return;
      }
      action();
    },
    [selected],
  );

  const open = useCallback(
    (doc: Document | 'new' | null) => {
      requestNav(() => gotoFile(doc));
    },
    [requestNav, gotoFile],
  );

  const closeTab = useCallback(
    (id: number) => {
      requestNav(() => {
        close(id);
        if (id === selectedId) {
          const rest = tabs.filter((t) => t.id !== id);
          gotoId(rest.length ? rest[0].id : null);
        }
      });
    },
    [requestNav, close, selectedId, tabs, gotoId],
  );

  const create = async (opt: NewFileOption, name: string) => {
    const withExt = name.toLowerCase().endsWith(`.${opt.ext}`) ? name : `${name}.${opt.ext}`;
    setCreating(true);
    try {
      const doc = await documentsService.create(withExt, null, opt.content);
      qc.invalidateQueries({ queryKey: ['app-files'] });
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['folders'] });
      setNaming(null);
      gotoFile(doc);
    } catch (err) {
      toast.error('Could not create the file', apiErrorMessage(err, 'Please try again.'));
    } finally {
      setCreating(false);
    }
  };

  const upload = async (list: FileList) => {
    setUploading(true);
    let last: Document | null = null;
    for (const f of Array.from(list)) {
      try {
        last = await documentsService.upload(f, null);
      } catch (err) {
        toast.error(`Could not upload ${f.name}`, apiErrorMessage(err, 'Please try again.'));
      }
    }
    setUploading(false);
    qc.invalidateQueries({ queryKey: ['app-files'] });
    qc.invalidateQueries({ queryKey: ['documents'] });
    if (last) {
      if (acceptsDoc(app, last)) open(last);
      else toast.error(`${app.title} cannot open ${last.filename}`, 'It was saved to your files.');
    }
  };

  const newOptions = app.newFiles ?? [];
  const canCreate = newOptions.length > 0 || app.editor === 'whiteboard';
  const hasOpen = !!selected || blankBoard;

  const onDirtyChange = useCallback(
    (d: boolean) => {
      saveCtx.report({ dirty: d, saving: saveCtx.saving });
    },
    [saveCtx],
  );

  const newButton = canCreate && (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          if (app.editor === 'whiteboard') open('new');
          else if (newOptions.length === 1) setNaming(newOptions[0]);
          else setNewMenu((o) => !o);
        }}
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
      >
        <Plus className="h-4 w-4" /> {app.editor === 'whiteboard' ? 'New board' : 'New'}
        {newOptions.length > 1 && <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {newMenu && (
        <div className="absolute left-0 top-full z-30 mt-1 w-52 rounded-md border border-border/60 bg-popover p-1 shadow-lg">
          {newOptions.map((o) => (
            <button
              key={o.ext}
              type="button"
              onClick={() => {
                setNewMenu(false);
                setNaming(o);
              }}
              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[13px] hover:bg-muted"
            >
              {o.label} <span className="text-[11px] text-muted-foreground">.{o.ext}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="app-no-print">
        <AppBar
          app={app}
          doc={selected}
          panelOpen={panelOpen}
          onTogglePanel={togglePanel}
          onNewFile={(opt) => setNaming(opt)}
          onOpenFile={open}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ['app-files'] });
            qc.invalidateQueries({ queryKey: ['documents'] });
          }}
          onTrashed={() => {
            if (selectedId !== null) close(selectedId);
            gotoFile(null);
          }}
          onShowHistory={() => setHistoryOpen(true)}
        />
      </div>

      {tabs.length > 0 && (
        <div
          className="app-no-print flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border/60 bg-card px-2 py-1"
          role="tablist"
          aria-label="Open files"
        >
          {tabs.map((t) => {
            const active = t.id === selectedId;
            return (
              <div
                key={t.id}
                role="tab"
                aria-selected={active}
                className={cn(
                  'flex shrink-0 items-center gap-1 rounded-md pr-1',
                  active ? 'bg-primary/10' : 'hover:bg-muted',
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!active) {
                      const known = all.find((d) => d.id === t.id);
                      if (known) open(known);
                      else requestNav(() => gotoId(t.id));
                    }
                  }}
                  title={tabName(t.id)}
                  className="max-w-44 truncate px-2 py-1.5 text-left text-[12.5px]"
                >
                  {active && saveCtx.dirty ? (
                    <span aria-label="Unsaved changes">• {tabName(t.id)}</span>
                  ) : (
                    tabName(t.id)
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => closeTab(t.id)}
                  aria-label={`Close ${tabName(t.id)}`}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* File panel: static when it fits, a drawer on phones. */}
        <aside
          className={cn(
            'min-h-0 bg-card',
            hasOpen
              ? panelOpen
                ? 'fixed inset-y-0 left-0 z-40 flex w-80 max-w-[85vw] flex-col border-r border-border/60 shadow-xl md:static md:z-auto md:w-72 md:shadow-none'
                : 'hidden'
              : 'flex w-full flex-col md:w-72 md:border-r md:border-border/60',
          )}
          aria-label={`${app.title} files`}
        >
          <div className="flex shrink-0 items-center gap-2 p-3">
            {newButton}
            {app.uploadAccept && (
              <>
                <button
                  type="button"
                  onClick={() => uploadInput.current?.click()}
                  disabled={uploading}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border/60 px-3 text-[13px] hover:bg-muted disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload
                </button>
                <input
                  ref={uploadInput}
                  type="file"
                  multiple
                  accept={app.uploadAccept}
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) void upload(e.target.files);
                    e.target.value = '';
                  }}
                />
              </>
            )}
            {hasOpen && (
              <button
                type="button"
                onClick={togglePanel}
                aria-label="Close file panel"
                className="ml-auto rounded-md p-2 text-muted-foreground hover:bg-muted md:hidden"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="mx-3 mb-2 flex shrink-0 items-center gap-2 rounded-md border border-border/60 bg-background px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${app.title.toLowerCase()} files…`}
              aria-label="Search files"
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-3">
            {files.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading your files…
              </div>
            ) : files.isError ? (
              <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
                {apiErrorMessage(files.error, 'Could not load your files.')}
              </p>
            ) : all.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-[13px] font-medium">No {app.title} files yet</p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {canCreate ? 'Create one or upload from your computer.' : 'Upload one from your computer.'} Files your agents make show up here too.
                </p>
              </div>
            ) : shown.length === 0 ? (
              <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">Nothing matches “{query}”.</p>
            ) : (
              <ul className="m-0 list-none space-y-0.5 p-0">
                {shown.map((d) => {
                  const FIcon = fileIcon(d);
                  const active = d.id === selectedId;
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => {
                          open(d);
                          if (window.innerWidth < 768) setPanelOpen(false);
                        }}
                        aria-current={active}
                        className={cn(
                          'flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left',
                          active ? 'bg-primary/10' : 'hover:bg-muted',
                        )}
                      >
                        <FIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className={cn('block truncate text-[13px]', active && 'font-medium')}>{d.filename}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {locationOf(d)} · {formatDate(d.updated_at)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {files.hasNextPage && (
              <button
                type="button"
                onClick={() => void files.fetchNextPage()}
                disabled={files.isFetchingNextPage}
                className="mx-auto mt-2 block rounded-md px-3 py-1.5 text-[12.5px] text-primary hover:bg-muted"
              >
                {files.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </aside>
        {hasOpen && panelOpen && (
          <button
            type="button"
            aria-label="Close file panel"
            onClick={togglePanel}
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
          />
        )}

        {/* Editor */}
        <main className={cn('app-print-area min-h-0 min-w-0 flex-1 flex-col', hasOpen ? 'flex' : 'hidden md:flex')}>
          {blankBoard ? (
            <Whiteboard doc={null} onCreated={(d) => gotoFile(d)} />
          ) : selected ? (
            <AppEditor
              key={`${selected.id}:${epoch}`}
              app={app}
              doc={selected}
              siblings={shown}
              onDirtyChange={onDirtyChange}
              onOpenDoc={(d) => open(d)}
            />
          ) : selectedId !== null && !missing ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Opening…
            </div>
          ) : (
            <Welcome
              app={app}
              missing={missing}
              recent={recent.docs}
              recentLabel={recent.label}
              onOpen={open}
              actions={
                app.editor === 'whiteboard' ? (
                  <button type="button" onClick={() => open('new')} className={PRIMARY_BTN}>
                    <Plus className="h-4 w-4" /> New board
                  </button>
                ) : (
                  newOptions.map((o) => (
                    <button key={o.ext} type="button" onClick={() => setNaming(o)} className={PRIMARY_BTN}>
                      <Plus className="h-4 w-4" /> New {o.label.toLowerCase()}
                    </button>
                  ))
                )
              }
              onAskAi={() => navigate(`/ai-chat?new=${encodeURIComponent(app.newPrompt)}`)}
            />
          )}
        </main>

        {selected && historyOpen && (
          <div className="app-no-print flex min-h-0 max-md:contents">
            <VersionHistoryPanel
              key={selected.id}
              doc={selected}
              onRestored={() => {
                setEpoch((e) => e + 1);
                qc.invalidateQueries({ queryKey: ['app-files'] });
                qc.invalidateQueries({ queryKey: ['documents'] });
              }}
              onClose={() => setHistoryOpen(false)}
            />
          </div>
        )}
      </div>

      {naming && (
        <NameDialog
          title={`New ${naming.label.toLowerCase()}`}
          initial={`Untitled.${naming.ext}`}
          busy={creating}
          onSubmit={(name) => void create(naming, name)}
          onCancel={() => setNaming(null)}
        />
      )}

      {pending && (
        <UnsavedDialog
          filename={pending.filename}
          onSaved={() => {
            const { action } = pending;
            setPending(null);
            action();
          }}
          onDontSave={() => {
            const { action } = pending;
            setPending(null);
            action();
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}

function Welcome({
  app, missing, recent, recentLabel, onOpen, actions, onAskAi,
}: {
  app: AppMeta;
  missing: boolean;
  recent: Document[];
  recentLabel: string;
  onOpen: (d: Document) => void;
  actions: React.ReactNode;
  onAskAi: () => void;
}) {
  const Icon = app.icon;
  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-auto px-6 py-10 text-center">
      <span className={cn('mb-4 inline-flex rounded-2xl bg-gradient-to-br p-4 text-white shadow-md', app.tint)}>
        <Icon className="h-8 w-8" />
      </span>
      <h2 className="text-lg font-semibold">{app.title}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {missing ? 'That file is no longer available — it may have been moved to Trash.' : app.description}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {actions}
        <button
          type="button"
          onClick={onAskAi}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border/60 px-3 text-[13px] hover:bg-muted"
        >
          <Sparkles className="h-4 w-4 text-primary" /> Ask AI to make one
        </button>
      </div>
      {recent.length > 0 && (
        <div className="mt-8 w-full max-w-xl text-left">
          <p className="mb-2 text-[12px] font-medium text-muted-foreground">{recentLabel}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {recent.map((d) => {
              const FIcon = fileIcon(d);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onOpen(d)}
                  className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-card px-3 py-2.5 text-left hover:border-primary/40"
                >
                  <FIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px]">{d.filename}</span>
                    <span className="block text-[11px] text-muted-foreground">{formatDate(d.updated_at)} · {formatSize(d.file_size)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}


