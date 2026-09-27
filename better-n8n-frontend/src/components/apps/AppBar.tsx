/**
 * The one app bar: home, the app switcher, the file name, the File menu and
 * the save status — everything that used to be four stacked bars.
 *
 * The file name *is* the rename control (click to edit, Enter to save via
 * `PATCH documents/<id>/`); the save status moved up here from the editor
 * footer so it is visible wherever the toolbar overflowed to on a phone.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Home, Loader2, PanelLeft } from 'lucide-react';

import { documentsService, type Document } from '../../api/documents';
import { APPS, type AppMeta, type NewFileOption } from '../../lib/apps';
import { apiErrorMessage } from '../../lib/apiError';
import { toast } from '../../lib/toastStore';
import { cn } from '../../lib/utils';
import { useSave } from './useSave';
import FileMenu from './FileMenu';

interface Props {
  app: AppMeta;
  doc: Document | null;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onNewFile: (opt: NewFileOption) => void;
  onOpenFile: (doc: Document) => void;
  onChanged: (doc: Document) => void;
  onTrashed: () => void;
  onShowHistory: () => void;
}

export default function AppBar(props: Props) {
  const { app, doc } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const save = useSave();
  const Icon = app.icon;

  useEffect(() => {
    if (!switcherOpen) return;
    const onDown = (e: PointerEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [switcherOpen]);

  const startRename = () => {
    if (!doc) return;
    setName(doc.filename);
    setRenaming(true);
  };

  const commitRename = async () => {
    if (!doc) {
      setRenaming(false);
      return;
    }
    const next = name.trim();
    if (!next || next === doc.filename) {
      setRenaming(false);
      return;
    }
    setSaving(true);
    try {
      const saved = await documentsService.rename(doc.id, next);
      qc.invalidateQueries({ queryKey: ['app-files'] });
      qc.invalidateQueries({ queryKey: ['documents'] });
      props.onChanged(saved);
    } catch (err) {
      toast.error('Could not rename the file', apiErrorMessage(err, 'Please try again.'));
    } finally {
      setSaving(false);
      setRenaming(false);
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-card px-2 md:gap-2 md:px-3">
      <button
        type="button"
        onClick={props.onTogglePanel}
        title={props.panelOpen ? 'Hide file panel' : 'Show file panel'}
        aria-label={props.panelOpen ? 'Hide file panel' : 'Show file panel'}
        aria-pressed={props.panelOpen}
        className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <PanelLeft className="h-4 w-4" />
      </button>
      <Link
        to="/apps"
        title="All apps"
        aria-label="All apps"
        className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Home className="h-4 w-4" />
      </Link>

      <div ref={switcherRef} className="relative">
        <button
          type="button"
          onClick={() => setSwitcherOpen((o) => !o)}
          aria-expanded={switcherOpen}
          title={`Switch app (now in ${app.title})`}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1.5 hover:bg-muted"
        >
          <span className={cn('inline-flex rounded-md bg-gradient-to-br p-1 text-white', app.tint)}>
            <Icon className="h-4 w-4" />
          </span>
          <span className="hidden text-[13px] font-semibold sm:inline">{app.title}</span>
          <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:inline" />
        </button>
        {switcherOpen && (
          <div className="absolute left-0 top-full z-40 mt-1 grid w-[min(22rem,80vw)] grid-cols-2 gap-1 rounded-lg border border-border/60 bg-popover p-2 shadow-lg">
            {APPS.filter((a) => a.kind === 'workspace').map((a) => {
              const AIcon = a.icon;
              const active = a.id === app.id;
              return (
                <Link
                  key={a.id}
                  to={a.path}
                  onClick={() => setSwitcherOpen(false)}
                  aria-current={active}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-2 no-underline hover:bg-muted',
                    active && 'bg-primary/10',
                  )}
                >
                  <span className={cn('inline-flex rounded-md bg-gradient-to-br p-1 text-white', a.tint)}>
                    <AIcon className="h-3.5 w-3.5" />
                  </span>
                  <span className="truncate text-[12.5px] text-foreground">{a.title}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen}
          className="rounded-md px-2.5 py-2 text-[13px] font-medium text-foreground hover:bg-muted"
        >
          File
        </button>
        {menuOpen && (
          <FileMenu
            key={doc?.id ?? 'none'}
            app={app}
            doc={doc}
            onRename={startRename}
            onNewFile={props.onNewFile}
            onOpenFile={props.onOpenFile}
            onChanged={props.onChanged}
            onTrashed={props.onTrashed}
            onShowHistory={props.onShowHistory}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </div>

      <div className="min-w-0 flex-1 px-1 text-center">
        {doc ? (
          renaming ? (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename();
                if (e.key === 'Escape') setRenaming(false);
              }}
              aria-label="File name"
              className="mx-auto block w-full max-w-xs rounded-md border border-primary/50 bg-background px-2 py-1 text-center text-[13px] font-medium outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={startRename}
              title="Click to rename"
              className="mx-auto block max-w-full truncate rounded px-2 py-0.5 text-[13px] font-medium hover:bg-muted"
            >
              {saving ? 'Saving name…' : doc.filename}
            </button>
          )
        ) : (
          <span className="text-[13px] text-muted-foreground">{app.title}</span>
        )}
      </div>

      <div
        className="hidden items-center gap-1.5 pr-1 text-[11.5px] text-muted-foreground sm:flex"
        role="status"
        aria-label="Save status"
      >
        {save.saving ? (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving…
          </span>
        ) : save.dirty ? (
          <span className="font-medium text-foreground">• Unsaved changes</span>
        ) : doc ? (
          <span className="inline-flex items-center gap-1">
            <Check className="h-3 w-3" /> Saved
          </span>
        ) : null}
      </div>
    </header>
  );
}

