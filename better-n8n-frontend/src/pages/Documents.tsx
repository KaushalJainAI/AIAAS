/**
 * `/documents` — the file browser, shaped like Windows Explorer.
 *
 * A navigation pane (quick access, the folder tree, the places that are not
 * folders), an address row (back / forward / up, a clickable path, search),
 * a command bar, the items in Details / Tiles / List, an optional preview
 * pane, and a status bar. Everything a desktop user reaches for without
 * thinking works here too: multi-select with Ctrl and Shift, right-click
 * menus, cut/copy/paste, F2 to rename, Delete, drag to a folder (in the
 * list, the tree or the address bar), and dropping files from the desktop to
 * upload.
 *
 * Three rules carried over from the page this replaced, still load-bearing:
 * the API is id-addressed (the path shown is for reading, never sent back);
 * a delete goes to the recycle bin; and a folder that is empty is *not* the
 * same as an account with no files — "upload your first file" is shown only
 * when the user has no files anywhere, because agent-written files live in
 * `/Chat/` and `/Agents/` and an empty root does not mean an empty library.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, ArrowLeft, ArrowRight, ArrowUp, BookOpen, Check, ChevronDown, ChevronRight, ClipboardPaste,
  Clock, Copy, Download, Eye, ExternalLink, FilePlus2, Folder as FolderIcon, FolderInput, FolderPlus, Globe,
  Home, Info, LayoutGrid, List as ListIcon, Loader2, PanelLeft, PanelRight, Pencil, RefreshCw, RotateCcw,
  ScanText, Scissors, Search, Table as TableIcon, Trash2, Upload, X,
} from 'lucide-react';

import { documentsService, foldersService, type Document, type Folder } from '../api';
import NameDialog from '../components/apps/NameDialog';
import { DocumentPreviewModal } from '../components/documents/DocumentPreviewModal';
import FolderPickerModal from '../components/documents/FolderPickerModal';
import ContextMenu, { type MenuEntry } from '../components/explorer/ContextMenu';
import ItemsView, { type ViewMode } from '../components/explorer/ItemsView';
import NavPane from '../components/explorer/NavPane';
import PropertiesDialog from '../components/explorer/PropertiesDialog';
import ExtractionPanel from '../components/extraction/ExtractionPanel';

import FilePreview from '../components/files/FilePreview';
import PreviewFrame from '../components/files/PreviewFrame';
import SidebarMenuButton from '../components/layout/SidebarMenuButton';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { usePersistedState } from '../hooks/usePersistedState';
import { apiErrorMessage } from '../lib/apiError';
import { appsForDoc, openInAppPath, type NewFileOption } from '../lib/apps';
import {
  clickSelect, emptySelection, keyOf, nextSort, sameLocation, sortItems, stepSelect,
  type Item, type Location, type Selection, type Sort,
} from '../lib/explorer';
import { canNarrow, isSearchable, resultSections, searchParamsFor, SEARCH_DEBOUNCE_MS } from '../lib/documentSearch';
import { fileIcon, fileTint, formatDate, formatDateTime, formatSize, typeName } from '../lib/fileDisplay';
import { toast } from '../lib/toastStore';
import { cn } from '../lib/utils';
import { resolvePath } from '../lib/vfsPath';

const PAGE = 100;

const NEW_FILES: NewFileOption[] = [
  { ext: 'txt', label: 'Text document' },
  { ext: 'md', label: 'Markdown document', content: '# Untitled\n' },
  { ext: 'docx', label: 'Word document' },
  { ext: 'xlsx', label: 'Excel workbook' },
  { ext: 'csv', label: 'CSV table', content: 'Name,Value\n' },
  { ext: 'pptx', label: 'PowerPoint presentation' },
  { ext: 'html', label: 'Web page', content: '<!DOCTYPE html>\n<html>\n  <body>\n    <h1>Hello</h1>\n  </body>\n</html>\n' },
];

const LOCATION_KINDS = ['folder', 'recent', 'public', 'extraction', 'trash'];
const isLocation = (v: unknown): v is Location =>
  typeof v === 'object' && v !== null && LOCATION_KINDS.includes((v as { kind?: string }).kind ?? '');

type Clipboard = { mode: 'cut' | 'copy'; items: Item[] } | null;

export default function Documents() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // ---- Where we are, and how we got here ---------------------------------
  const [loc, setLocState] = usePersistedState<Location>('documents.location', { kind: 'folder', id: null }, { validate: isLocation });
  const [history, setHistory] = useState<{ stack: Location[]; index: number }>(() => ({ stack: [loc], index: 0 }));
  const [view, setView] = usePersistedState<ViewMode>('documents.layout', 'details', {
    validate: (v): v is ViewMode => v === 'details' || v === 'tiles' || v === 'list',
  });
  const [sort, setSort] = usePersistedState<Sort>('documents.sort', { key: 'name', dir: 'asc' });
  const [showPreview, setShowPreview] = usePersistedState('documents.previewPane', true);
  const [navOpen, setNavOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchAll, setSearchAll] = useState(false);

  // ---- Selection and the things done to it ---------------------------------
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<Clipboard>(null);
  const [dragging, setDragging] = useState<Item[] | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const [naming, setNaming] = useState<{ kind: 'folder' } | { kind: 'file'; opt: NewFileOption } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Item[] | null>(null);
  const [movePicker, setMovePicker] = useState<Item[] | null>(null);
  const [properties, setProperties] = useState<Item | null>(null);
  const [shareDoc, setShareDoc] = useState<Document | null>(null);
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null);
  const [uploads, setUploads] = useState<Document[]>([]);
  const [osDrop, setOsDrop] = useState(false);
  const [viewMenu, setViewMenu] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const pickFiles = useCallback(() => uploadInput.current?.click(), []);

  const folderId = loc.kind === 'folder' ? loc.id : null;
  const inFolder = loc.kind === 'folder';
  const mine = loc.kind === 'folder' || loc.kind === 'recent';

  const go = useCallback(
    (next: Location, { push = true }: { push?: boolean } = {}) => {
      setLocState(next);
      setSelection(emptySelection());
      setRenaming(null);
      setQuery('');
      setSearchAll(false);
      setNavOpen(false);
      if (push) {
        setHistory((h) => {
          if (sameLocation(h.stack[h.index], next)) return h;
          const stack = [...h.stack.slice(0, h.index + 1), next].slice(-50);
          return { stack, index: stack.length - 1 };
        });
      }
    },
    [setLocState],
  );
  const back = () => {
    if (history.index <= 0) return;
    const index = history.index - 1;
    setHistory({ ...history, index });
    go(history.stack[index], { push: false });
  };
  const forward = () => {
    if (history.index >= history.stack.length - 1) return;
    const index = history.index + 1;
    setHistory({ ...history, index });
    go(history.stack[index], { push: false });
  };

  // ---- Data ------------------------------------------------------------------
  const { data: folderPage } = useQuery({
    queryKey: ['folders', folderId],
    // A remembered folder that has since been deleted sends the user home,
    // rather than showing an error for a place they did not choose this visit.
    queryFn: () =>
      foldersService.list(folderId).catch((err) => {
        if (folderId !== null && (err as { response?: { status?: number } })?.response?.status === 404) {
          go({ kind: 'folder', id: null }, { push: false });
        }
        throw err;
      }),
    enabled: inFolder,
    staleTime: 60_000,
    retry: false,
  });

  const docsKey = loc.kind === 'folder' ? `folder:${loc.id ?? 'root'}` : loc.kind;
  const docs = useInfiniteQuery({
    queryKey: ['documents', 'explorer', docsKey],
    initialPageParam: null as string | null,
    enabled: loc.kind === 'folder' || loc.kind === 'recent' || loc.kind === 'public',
    queryFn: ({ pageParam }) =>
      documentsService.list({
        limit: PAGE,
        cursor: pageParam,
        scope: loc.kind === 'public' ? 'public' : 'personal',
        ...(loc.kind === 'folder' ? { folder_id: loc.id ?? ('root' as const) } : {}),
      }),
    getNextPageParam: (last) => (last.has_more ? last.next_cursor : undefined),
    refetchInterval: (q) => {
      const rows = q.state.data?.pages.flatMap((p) => p.my_documents) ?? [];
      return rows.some((d) => d.status === 'pending' || d.status === 'processing') ? 5000 : false;
    },
    staleTime: 60_000,
  });

  // Search: one character filters what is on screen; two or more ask the
  // server, which searches names and contents across the subtree (or the
  // whole library) and adds close matches by name (`inference/search.py`).
  const searching = query.trim().length > 0;
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);
  const listingLoc = loc.kind === 'folder' || loc.kind === 'recent' || loc.kind === 'public';
  const serverSearch = listingLoc && isSearchable(query);
  const searchArgs = searchParamsFor(loc, searchAll, debouncedQuery);
  const found = useQuery({
    queryKey: ['documents', 'search', searchArgs],
    queryFn: () => documentsService.searchFiles(searchArgs),
    enabled: listingLoc && isSearchable(debouncedQuery),
    // The last answer stays up while the next one loads, so the list does
    // not flash empty on every keystroke.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const sections = useMemo(
    () => (serverSearch ? resultSections(found.data) : resultSections(undefined)),
    [serverSearch, found.data],
  );

  // Whether the user owns any file at all — the only thing that earns the
  // first-run "upload your first file" screen.
  const { data: anyPage } = useQuery({
    queryKey: ['documents', 'has-any'],
    queryFn: () => documentsService.list({ limit: 1, scope: 'personal' }),
    staleTime: 60_000,
  });
  const hasAnyFile = (anyPage?.my_documents.length ?? 0) > 0;

  const { data: trashPage, isLoading: trashLoading } = useQuery({
    queryKey: ['trash'],
    queryFn: () => foldersService.trash.list(),
    enabled: loc.kind === 'trash',
  });

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['documents'] });
    qc.invalidateQueries({ queryKey: ['folders'] });
    qc.invalidateQueries({ queryKey: ['trash'] });
    qc.invalidateQueries({ queryKey: ['app-files'] });
  }, [qc]);

  const breadcrumbs = useMemo(() => folderPage?.breadcrumbs ?? [], [folderPage]);
  const currentFolder: Folder | null = folderPage?.folder ?? null;
  const trail = useMemo(
    () => [...breadcrumbs.map((b) => b.id), ...(currentFolder ? [currentFolder.id] : [])],
    [breadcrumbs, currentFolder],
  );
  const parentId = currentFolder ? (breadcrumbs[breadcrumbs.length - 1]?.id ?? null) : null;

  // ---- The items on screen -----------------------------------------------------
  const items: Item[] = useMemo(() => {
    // Server results keep the server's relevance order; exact then close.
    if (serverSearch) return [...sections.exact, ...sections.fuzzy];
    const needle = query.trim().toLowerCase();
    const match = (name: string) => !needle || name.toLowerCase().includes(needle);
    const pages = docs.data?.pages ?? [];
    const rows = loc.kind === 'public' ? pages.flatMap((p) => p.public_documents) : pages.flatMap((p) => p.my_documents);
    const folders: Item[] = loc.kind === 'folder'
      ? (folderPage?.folders ?? []).filter((f) => match(f.name)).map((folder) => ({ kind: 'folder', folder }))
      : [];
    const pending: Item[] = loc.kind === 'folder' ? uploads.map((doc) => ({ kind: 'doc', doc })) : [];
    const files: Item[] = rows.filter((d) => match(d.filename)).map((doc) => ({ kind: 'doc', doc }));
    const effective: Sort = loc.kind === 'recent' && sort.key === 'name' ? { key: 'modified', dir: 'desc' } : sort;
    return [...pending, ...sortItems([...folders, ...files], effective)];
  }, [serverSearch, sections, query, docs.data, loc.kind, folderPage, uploads, sort]);

  const order = useMemo(() => items.map(keyOf), [items]);
  const selectedItems = useMemo(() => items.filter((i) => selection.keys.has(keyOf(i))), [items, selection]);
  const selectedDocs = selectedItems.flatMap((i) => (i.kind === 'doc' ? [i.doc] : []));
  const single = selectedItems.length === 1 ? selectedItems[0] : null;
  const cutKeys = useMemo(
    () => new Set(clipboard?.mode === 'cut' ? clipboard.items.map(keyOf) : []),
    [clipboard],
  );

  // ---- Deep links: ?doc=<id> (a file card) and ?path=/Chat/a.md (prose) ----------
  const linkedPath = searchParams.get('path');
  const linkedDoc = Number(searchParams.get('doc')) || null;
  useEffect(() => {
    if (!linkedPath && !linkedDoc) return;
    let cancelled = false;
    const label = linkedPath ?? 'That file';
    const lookup = linkedDoc
      ? documentsService.get(linkedDoc).then((doc) => ({ folderId: doc.folder_id ?? null, doc, found: true }))
      : resolvePath(linkedPath as string);
    lookup
      .then(({ folderId: target, doc, found }) => {
        if (cancelled) return;
        go({ kind: 'folder', id: target });
        if (doc) {
          setSelection({ keys: new Set([`d:${doc.id}`]), anchor: `d:${doc.id}` });
          setPreviewDoc(doc);
        } else if (!found) toast.error(`${label} is not in your files. It may have been moved or deleted.`);
      })
      .catch((err) => !cancelled && toast.error(apiErrorMessage(err, `Could not open ${label.toLowerCase()}`)))
      .finally(() => {
        if (!cancelled) {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete('path');
            next.delete('doc');
            next.delete('kind');
            return next;
          }, { replace: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [linkedPath, linkedDoc, go, setSearchParams]);

  // ---- Actions -------------------------------------------------------------------
  const openItem = (item: Item) => {
    if (item.kind === 'folder') return go({ kind: 'folder', id: item.folder.id });
    const path = loc.kind === 'public' ? null : openInAppPath(item.doc);
    if (path) navigate(path);
    else setPreviewDoc(item.doc);
  };

  const download = async (doc: Document) => {
    try {
      const blob = await documentsService.download(doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error('Download failed', apiErrorMessage(err, 'Please try again.'));
    }
  };

  const rename = async (item: Item, name: string) => {
    setRenaming(null);
    try {
      if (item.kind === 'folder') await foldersService.update(item.folder.id, { name });
      else await documentsService.rename(item.doc.id, name);
      refresh();
    } catch (err) {
      toast.error('Could not rename', apiErrorMessage(err, 'Please try again.'));
    }
  };

  const move = async (moving: Item[], target: number | null) => {
    const folderIds = moving.flatMap((i) => (i.kind === 'folder' ? [i.folder.id] : []));
    const documentIds = moving.flatMap((i) => (i.kind === 'doc' && i.doc.id > 0 ? [i.doc.id] : []));
    if (target !== null && folderIds.includes(target)) return;
    if (!folderIds.length && !documentIds.length) return;
    setBusy(true);
    try {
      const r = await foldersService.move({ folder_ids: folderIds, document_ids: documentIds, target_folder_id: target });
      toast.success(`Moved ${r.moved_folders + r.moved_documents} item${r.moved_folders + r.moved_documents === 1 ? '' : 's'}`);
      refresh();
    } catch (err) {
      toast.error('Could not move', apiErrorMessage(err, 'Please try again.'));
    } finally {
      setBusy(false);
      setDragging(null);
      setMovePicker(null);
    }
  };

  const paste = async (target: number | null) => {
    if (!clipboard) return;
    if (clipboard.mode === 'cut') {
      await move(clipboard.items, target);
      setClipboard(null);
      return;
    }
    const docsToCopy = clipboard.items.flatMap((i) => (i.kind === 'doc' ? [i.doc] : []));
    setBusy(true);
    let copied = 0;
    for (const d of docsToCopy) {
      try {
        await documentsService.copy(d.id, target);
        copied += 1;
      } catch (err) {
        toast.error(`Could not copy ${d.filename}`, apiErrorMessage(err, 'Please try again.'));
      }
    }
    setBusy(false);
    if (copied) toast.success(`Copied ${copied} file${copied === 1 ? '' : 's'}`);
    refresh();
  };

  const remove = async (list: Item[]) => {
    setBusy(true);
    let days = 30;
    let failed = 0;
    for (const item of list) {
      try {
        if (item.kind === 'doc' && item.doc.id < 0) {
          setUploads((u) => u.filter((d) => d.id !== item.doc.id));
          continue;
        }
        const r = item.kind === 'folder' ? await foldersService.remove(item.folder.id) : await documentsService.delete(item.doc.id);
        days = r.purges_after_days ?? days;
      } catch {
        failed += 1;
      }
    }
    setBusy(false);
    setConfirmDelete(null);
    setSelection(emptySelection());
    if (failed) toast.error(`${failed} item${failed === 1 ? '' : 's'} could not be deleted`);
    else toast.success('Moved to Trash', `You can restore ${list.length === 1 ? 'it' : 'them'} for ${days} days.`);
    refresh();
  };

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    const target = inFolder ? folderId : null;
    const optimistic: Document[] = list.map((f, i) => ({
      id: -Date.now() - i, title: f.name, filename: f.name, file_type: f.name.split('.').pop() || 'other',
      file_size: f.size, chunk_count: 0, is_shared: false, shared_at: null, status: 'uploading',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }));
    setUploads((u) => [...optimistic, ...u]);
    let ok = 0;
    await Promise.allSettled(
      list.map(async (f, i) => {
        try {
          await documentsService.upload(f, target);
          ok += 1;
        } catch (err) {
          toast.error(`Could not upload ${f.name}`, apiErrorMessage(err, 'Please try again.'));
        } finally {
          setUploads((u) => u.filter((d) => d.id !== optimistic[i].id));
        }
      }),
    );
    if (ok) {
      toast.success(`Uploaded ${ok} file${ok === 1 ? '' : 's'}`);
      refresh();
    }
  };

  const create = async (name: string) => {
    if (!naming) return;
    setBusy(true);
    try {
      if (naming.kind === 'folder') {
        const f = await foldersService.create(name, folderId);
        setSelection({ keys: new Set([`f:${f.id}`]), anchor: `f:${f.id}` });
      } else {
        const ext = naming.opt.ext;
        const full = name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`;
        const d = await documentsService.create(full, folderId, naming.opt.content);
        setSelection({ keys: new Set([`d:${d.id}`]), anchor: `d:${d.id}` });
      }
      setNaming(null);
      refresh();
    } catch (err) {
      toast.error('Could not create', apiErrorMessage(err, 'Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const toggleShare = async (doc: Document, confirmed = false) => {
    if (!doc.is_shared && !confirmed) return setShareDoc(doc);
    try {
      const r = await documentsService.toggleSharing(doc.id);
      toast.success(r.is_shared ? 'Shared to the public library' : 'Removed from the public library');
      refresh();
    } catch (err) {
      toast.error('Could not update sharing', apiErrorMessage(err, 'Please try again.'));
    } finally {
      setShareDoc(null);
    }
  };

  const restore = async (payload: { folder_ids?: number[]; document_ids?: number[] }) => {
    try {
      const r = await foldersService.trash.restore(payload);
      const refused = r.refused[0];
      if (refused?.reason === 'parent_still_trashed') {
        toast.error('Restore the folder first', 'This item lives inside a folder that is also in Trash.');
      } else {
        const renamed = r.restored.find((x) => x.renamed_to);
        toast.success('Restored', renamed ? `A name was taken, so it came back as “${renamed.renamed_to}”.` : undefined);
      }
      refresh();
    } catch (err) {
      toast.error('Could not restore', apiErrorMessage(err, 'Please try again.'));
    }
  };

  const emptyTrash = async () => {
    if (!window.confirm('Permanently delete everything in Trash? This cannot be undone.')) return;
    try {
      const r = await foldersService.trash.empty();
      toast.success('Trash emptied', `${r.purged_documents} file(s) and ${r.purged_folders} folder(s) removed.`);
      refresh();
    } catch (err) {
      toast.error('Could not empty Trash', apiErrorMessage(err, 'Please try again.'));
    }
  };

  // ---- Menus -------------------------------------------------------------------------
  const icon = (I: typeof Eye) => <I className="h-4 w-4" />;

  const newSubmenu: MenuEntry[] = [
    { label: 'Folder', icon: icon(FolderPlus), onSelect: () => setNaming({ kind: 'folder' }) },
    'separator',
    ...NEW_FILES.map((opt) => ({
      label: opt.label,
      icon: icon(fileIcon({ filename: `x.${opt.ext}`, file_type: opt.ext })),
      onSelect: () => setNaming({ kind: 'file', opt }),
    })),
  ];

  const itemMenu = (list: Item[]): MenuEntry[] => {
    const one = list.length === 1 ? list[0] : null;
    const docsIn = list.flatMap((i) => (i.kind === 'doc' ? [i.doc] : []));
    const editable = mine && list.every((i) => i.kind === 'folder' || i.doc.id > 0);
    const entries: MenuEntry[] = [];
    if (one?.kind === 'folder') {
      entries.push({ label: 'Open', icon: icon(FolderIcon), onSelect: () => openItem(one) });
    } else if (one?.kind === 'doc') {
      const apps = loc.kind === 'public' ? [] : appsForDoc(one.doc);
      const primary = apps[0];
      entries.push({
        label: primary ? `Open in ${primary.title}` : 'Preview',
        icon: icon(primary ? primary.icon : Eye),
        shortcut: 'Enter',
        onSelect: () => openItem(one),
      });
      if (apps.length > 1) {
        entries.push({
          label: 'Open with',
          icon: icon(ExternalLink),
          submenu: apps.map((a) => ({ label: a.title, icon: icon(a.icon), onSelect: () => navigate(openInAppPath(one.doc, a)!) })),
        });
      }
      if (primary) entries.push({ label: 'Preview', icon: icon(Eye), shortcut: 'Space', onSelect: () => setPreviewDoc(one.doc) });
    }
    if (docsIn.length) {
      entries.push({ label: docsIn.length > 1 ? `Download ${docsIn.length} files` : 'Download', icon: icon(Download), onSelect: () => docsIn.forEach((d) => void download(d)) });
    }
    if (editable) {
      entries.push(
        'separator',
        { label: 'Cut', icon: icon(Scissors), shortcut: 'Ctrl+X', onSelect: () => setClipboard({ mode: 'cut', items: list }) },
        {
          label: 'Copy', icon: icon(Copy), shortcut: 'Ctrl+C',
          disabled: !docsIn.length,
          onSelect: () => setClipboard({ mode: 'copy', items: list.filter((i) => i.kind === 'doc') }),
        },
      );
      if (one?.kind === 'folder' && clipboard) {
        entries.push({ label: 'Paste into folder', icon: icon(ClipboardPaste), onSelect: () => void paste(one.folder.id) });
      }
      entries.push('separator');
      if (one) entries.push({ label: 'Rename', icon: icon(Pencil), shortcut: 'F2', onSelect: () => setRenaming(keyOf(one)) });
      entries.push({ label: 'Move to…', icon: icon(FolderInput), onSelect: () => setMovePicker(list) });
      if (one?.kind === 'doc') {
        entries.push({
          label: one.doc.is_shared ? 'Remove from public library' : 'Share to public library',
          icon: icon(Globe),
          disabled: one.doc.status === 'uploading',
          onSelect: () => void toggleShare(one.doc),
        });
      }
      entries.push({ label: 'Delete', icon: icon(Trash2), shortcut: 'Del', danger: true, onSelect: () => setConfirmDelete(list) });
    }
    if (one) entries.push('separator', { label: 'Properties', icon: icon(Info), onSelect: () => setProperties(one) });
    return entries;
  };

  const backgroundMenu = (): MenuEntry[] => [
    ...(inFolder
      ? ([
          { label: 'New', icon: icon(FilePlus2), submenu: newSubmenu },
          { label: 'Upload files…', icon: icon(Upload), onSelect: () => uploadInput.current?.click() },
          { label: 'Paste', icon: icon(ClipboardPaste), shortcut: 'Ctrl+V', disabled: !clipboard, onSelect: () => void paste(folderId) },
          'separator',
        ] as MenuEntry[])
      : []),
    {
      label: 'View', icon: icon(LayoutGrid), submenu: [
        { label: 'Details', icon: view === 'details' ? icon(Check) : undefined, onSelect: () => setView('details') },
        { label: 'Tiles', icon: view === 'tiles' ? icon(Check) : undefined, onSelect: () => setView('tiles') },
        { label: 'List', icon: view === 'list' ? icon(Check) : undefined, onSelect: () => setView('list') },
      ],
    },
    { label: 'Select all', shortcut: 'Ctrl+A', onSelect: () => setSelection({ keys: new Set(order), anchor: order[0] ?? null }) },
    { label: 'Refresh', icon: icon(RefreshCw), onSelect: refresh },
  ];

  const openMenu = (e: { clientX: number; clientY: number }, entries: MenuEntry[]) =>
    setMenu({ x: e.clientX, y: e.clientY, items: entries });

  // ---- Pointer and keyboard ----------------------------------------------------------------
  const onItemClick = (item: Item, e: MouseEvent) => {
    pane.current?.focus({ preventScroll: true });
    setSelection((s) => clickSelect(s, order, keyOf(item), { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }));
  };

  const onItemMenu = (item: Item, e: MouseEvent) => {
    const key = keyOf(item);
    const list = selection.keys.has(key) ? selectedItems : [item];
    if (!selection.keys.has(key)) setSelection({ keys: new Set([key]), anchor: key });
    openMenu(e, itemMenu(list));
  };

  const onDragStart = (item: Item, e: DragEvent) => {
    const key = keyOf(item);
    const list = selection.keys.has(key) ? selectedItems : [item];
    if (!selection.keys.has(key)) setSelection({ keys: new Set([key]), anchor: key });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', list.map(keyOf).join(','));
    setDragging(mine ? list : null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    const cols = view === 'details' ? 1 : Math.max(1, Math.floor((pane.current?.clientWidth ?? 600) / (view === 'tiles' ? 128 : 240)));
    if (k === 'ArrowDown' || k === 'ArrowUp' || (view !== 'details' && (k === 'ArrowLeft' || k === 'ArrowRight'))) {
      if (k === 'ArrowLeft' && e.altKey) return;
      e.preventDefault();
      const delta = k === 'ArrowDown' ? cols : k === 'ArrowUp' ? -cols : k === 'ArrowRight' ? 1 : -1;
      setSelection((s) => stepSelect(s, order, delta, e.shiftKey));
    } else if (k === 'Enter' && single) {
      e.preventDefault();
      openItem(single);
    } else if (k === ' ' && single?.kind === 'doc') {
      e.preventDefault();
      setPreviewDoc(single.doc);
    } else if ((k === 'Delete') && selectedItems.length && mine) {
      e.preventDefault();
      setConfirmDelete(selectedItems);
    } else if (k === 'F2' && single && mine) {
      e.preventDefault();
      setRenaming(keyOf(single));
    } else if (ctrl && k.toLowerCase() === 'a') {
      e.preventDefault();
      setSelection({ keys: new Set(order), anchor: order[0] ?? null });
    } else if (ctrl && k.toLowerCase() === 'x' && selectedItems.length && mine) {
      setClipboard({ mode: 'cut', items: selectedItems });
    } else if (ctrl && k.toLowerCase() === 'c' && selectedDocs.length && mine) {
      setClipboard({ mode: 'copy', items: selectedItems.filter((i) => i.kind === 'doc') });
    } else if (ctrl && k.toLowerCase() === 'v' && clipboard && inFolder) {
      e.preventDefault();
      void paste(folderId);
    } else if ((k === 'Backspace' || (e.altKey && k === 'ArrowUp')) && inFolder && currentFolder) {
      e.preventDefault();
      go({ kind: 'folder', id: parentId });
    } else if (e.altKey && k === 'ArrowLeft') {
      e.preventDefault();
      back();
    } else if (e.altKey && k === 'ArrowRight') {
      e.preventDefault();
      forward();
    } else if (k === 'Escape') {
      setSelection(emptySelection());
      if (clipboard?.mode === 'cut') setClipboard(null);
    }
  };

  // Keep the keyboard-selected item in view.
  useEffect(() => {
    const last = [...selection.keys].pop();
    if (!last) return;
    pane.current?.querySelector<HTMLElement>(`[data-key="${last}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selection]);

  // ---- Rendering helpers ---------------------------------------------------------------------
  const title =
    loc.kind === 'folder' ? (currentFolder?.name ?? 'Home')
      : loc.kind === 'recent' ? 'Recent'
        : loc.kind === 'public' ? 'Public library'
          : loc.kind === 'extraction' ? 'Extraction' : 'Trash';

  const listing = loc.kind === 'folder' || loc.kind === 'recent' || loc.kind === 'public';
  const loading = !serverSearch && listing && (docs.isLoading || (inFolder && !folderPage)) && items.length === 0;

  // One list, or one per search section — the same row contract either way.
  const renderItems = (list: Item[]) => (
    <ItemsView
      items={list}
      view={view}
      sort={sort}
      onSort={(k) => setSort((s) => nextSort(s, k))}
      sortable={!serverSearch}
      subtitle={serverSearch ? (item) => sections.subtitles.get(keyOf(item)) : undefined}
      selected={selection.keys}
      cut={cutKeys}
      renaming={renaming}
      showLocation={loc.kind === 'public' ? 'author' : loc.kind !== 'folder' || serverSearch ? 'path' : undefined}
      onItemClick={onItemClick}
      onItemOpen={openItem}
      onItemMenu={onItemMenu}
      onRename={(item, name) => void rename(item, name)}
      onRenameCancel={() => setRenaming(null)}
      onDragStart={onDragStart}
      onDragEnd={() => setDragging(null)}
      onDropOnFolder={(id) => dragging && void move(dragging, id)}
      canDrop={!!dragging}
    />
  );
  const selectedSize = selectedDocs.reduce((n, d) => n + (d.file_size || 0), 0);

  const cmd = (label: string, I: typeof Eye, onClick: () => void, disabled = false) => (
    <Cmd label={label} icon={I} onClick={onClick} disabled={disabled} />
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      {/* Address row */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-card px-2 py-2 md:px-3">
        <SidebarMenuButton />
        <button type="button" onClick={() => setNavOpen((o) => !o)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted lg:hidden" aria-label="Show folders">
          <PanelLeft className="h-4 w-4" />
        </button>
        <button type="button" onClick={back} disabled={history.index <= 0} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30" aria-label="Back (Alt+Left)" title="Back (Alt+Left)">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button type="button" onClick={forward} disabled={history.index >= history.stack.length - 1} className="hidden rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30 sm:block" aria-label="Forward (Alt+Right)" title="Forward (Alt+Right)">
          <ArrowRight className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => go({ kind: 'folder', id: parentId })} disabled={!inFolder || !currentFolder} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30" aria-label="Up (Alt+Up)" title="Up (Alt+Up)">
          <ArrowUp className="h-4 w-4" />
        </button>
        <button type="button" onClick={refresh} className="hidden rounded-md p-1.5 text-muted-foreground hover:bg-muted sm:block" aria-label="Refresh" title="Refresh">
          <RefreshCw className={cn('h-4 w-4', docs.isFetching && 'animate-spin')} />
        </button>

        <nav aria-label="Address" className="mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden rounded-md border border-border/60 bg-background px-1.5 py-1 text-[13px]">
          {loc.kind === 'folder' ? (
            <>
              <Crumb label="Home" icon={<Home className="h-3.5 w-3.5" />} onClick={() => go({ kind: 'folder', id: null })} onDrop={dragging ? () => void move(dragging, null) : undefined} current={!currentFolder} />
              {breadcrumbs.map((b) => (
                <Crumb key={b.id} label={b.name} onClick={() => go({ kind: 'folder', id: b.id })} onDrop={dragging ? () => void move(dragging, b.id) : undefined} />
              ))}
              {currentFolder && <Crumb label={currentFolder.name} current />}
            </>
          ) : (
            <Crumb
              label={title}
              current
              icon={
                loc.kind === 'recent' ? <Clock className="h-3.5 w-3.5" /> : loc.kind === 'public' ? <BookOpen className="h-3.5 w-3.5" />
                  : loc.kind === 'extraction' ? <ScanText className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />
              }
            />
          )}
        </nav>

        {listing && (
          <div className="hidden w-56 items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1 md:flex lg:w-72">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${title}`}
              aria-label="Search"
              className="w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Command bar */}
      {loc.kind !== 'extraction' && (
        <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/60 bg-card px-2 py-1 scrollbar-none md:px-3">
          {loc.kind === 'trash' ? (
            <button type="button" onClick={() => void emptyTrash()} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-destructive hover:bg-destructive/10">
              <Trash2 className="h-4 w-4" /> Empty Trash
            </button>
          ) : (
            <>
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({ x: r.left, y: r.bottom + 4, items: newSubmenu });
                  }}
                  disabled={!inFolder}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[12.5px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                >
                  <FilePlus2 className="h-4 w-4" /> New <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <Cmd label="Upload" icon={Upload} onClick={pickFiles} disabled={!inFolder} wide />
              <span className="mx-1 h-5 w-px shrink-0 bg-border/70" />
              {cmd('Cut', Scissors, () => setClipboard({ mode: 'cut', items: selectedItems }), !mine || !selectedItems.length)}
              {cmd('Copy', Copy, () => setClipboard({ mode: 'copy', items: selectedItems.filter((i) => i.kind === 'doc') }), !mine || !selectedDocs.length)}
              {cmd('Paste', ClipboardPaste, () => void paste(folderId), !inFolder || !clipboard)}
              {cmd('Rename', Pencil, () => single && setRenaming(keyOf(single)), !mine || !single)}
              {cmd('Share', Globe, () => single?.kind === 'doc' && void toggleShare(single.doc), !mine || single?.kind !== 'doc')}
              {cmd('Delete', Trash2, () => setConfirmDelete(selectedItems), !mine || !selectedItems.length)}
              {cmd('Download', Download, () => selectedDocs.forEach((d) => void download(d)), !selectedDocs.length)}
              <span className="ml-auto" />
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setViewMenu((o) => !o)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-foreground/80 hover:bg-muted"
                  aria-label="Change layout"
                >
                  {view === 'details' ? <TableIcon className="h-4 w-4" /> : view === 'tiles' ? <LayoutGrid className="h-4 w-4" /> : <ListIcon className="h-4 w-4" />}
                  <span className="hidden sm:inline">View</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {viewMenu && (
                  <div className="absolute right-0 top-full z-40 mt-1 w-40 rounded-lg border border-border/70 bg-popover p-1 shadow-xl" onMouseLeave={() => setViewMenu(false)}>
                    {([['details', 'Details', TableIcon], ['tiles', 'Tiles', LayoutGrid], ['list', 'List', ListIcon]] as const).map(([v, label, I]) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => {
                          setView(v);
                          setViewMenu(false);
                        }}
                        className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted', view === v && 'font-medium')}
                      >
                        <I className="h-4 w-4" /> {label}
                        {view === v && <Check className="ml-auto h-3.5 w-3.5" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowPreview((p) => !p)}
                aria-pressed={showPreview}
                className={cn('hidden h-8 items-center gap-1.5 rounded-md px-2 text-[12.5px] hover:bg-muted lg:inline-flex', showPreview ? 'text-foreground' : 'text-foreground/60')}
                title="Preview pane"
              >
                <PanelRight className="h-4 w-4" /> <span className="hidden xl:inline">Preview pane</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Mobile search */}
      {listing && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 bg-card px-3 py-1.5 md:hidden">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${title}`} aria-label="Search"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground" />
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {/* Navigation pane */}
        {navOpen && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setNavOpen(false)} />}
        <aside
          className={cn(
            'z-40 w-60 shrink-0 flex-col border-r border-border/60 bg-card',
            navOpen ? 'fixed inset-y-0 left-0 flex shadow-xl' : 'hidden lg:flex',
          )}
        >
          <NavPane
            location={loc}
            trail={trail}
            onNavigate={(l) => go(l)}
            onDropOn={(id) => dragging && void move(dragging, id)}
            canDrop={!!dragging}
          />
        </aside>

        {/* Content */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {loc.kind === 'extraction' ? (
            <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
              <ExtractionPanel mode="manage" />
            </div>
          ) : loc.kind === 'trash' ? (
            <TrashView
              loading={trashLoading}
              folders={trashPage?.folders ?? []}
              docs={trashPage?.documents ?? []}
              days={trashPage?.purges_after_days ?? 30}
              onRestore={(p) => void restore(p)}
            />
          ) : (
            <div
              ref={pane}
              tabIndex={0}
              onKeyDown={onKeyDown}
              onClick={() => setSelection(emptySelection())}
              onContextMenu={(e) => {
                e.preventDefault();
                setSelection(emptySelection());
                openMenu(e, backgroundMenu());
              }}
              onDragOver={(e) => {
                if (!inFolder || !e.dataTransfer.types.includes('Files')) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setOsDrop(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOsDrop(false);
              }}
              onDrop={(e) => {
                setOsDrop(false);
                if (e.dataTransfer.files?.length && inFolder) {
                  e.preventDefault();
                  void upload(e.dataTransfer.files);
                }
              }}
              className={cn('relative min-h-0 flex-1 overflow-auto outline-none', osDrop && 'bg-primary/5 ring-2 ring-inset ring-primary')}
              aria-label={`${title} contents`}
            >
              {searching && listing && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-border/40 px-4 py-1.5 text-[12px] text-muted-foreground">
                  {!serverSearch ? (
                    <>Showing matching names here. Type another letter to search names and contents.</>
                  ) : loc.kind === 'public' ? (
                    <>Searching the public library{found.isFetching ? '…' : '.'}</>
                  ) : canNarrow(loc) && !searchAll ? (
                    <>
                      Searching {title} and its subfolders{found.isFetching ? '…' : '.'}
                      <button type="button" onClick={() => setSearchAll(true)} className="text-primary hover:underline">Search all files</button>
                    </>
                  ) : (
                    <>
                      Searching all your files{found.isFetching ? '…' : '.'}
                      {canNarrow(loc) && (
                        <button type="button" onClick={() => setSearchAll(false)} className="text-primary hover:underline">Only {title}</button>
                      )}
                    </>
                  )}
                </div>
              )}

              {loading || (serverSearch && !found.data && !found.isError) ? (
                <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> {serverSearch ? 'Searching…' : 'Loading…'}
                </div>
              ) : serverSearch && found.isError && items.length === 0 ? (
                <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-2 px-6 text-center">
                  <AlertCircle className="h-8 w-8 text-destructive" />
                  <p className="font-medium">Search failed</p>
                  <p className="text-sm text-muted-foreground">{apiErrorMessage(found.error, 'Please try again.')}</p>
                </div>
              ) : !serverSearch && docs.isError && items.length === 0 ? (
                <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-2 px-6 text-center">
                  <AlertCircle className="h-8 w-8 text-destructive" />
                  <p className="font-medium">Could not load your files</p>
                  <p className="text-sm text-muted-foreground">{apiErrorMessage(docs.error, 'Please try again.')}</p>
                </div>
              ) : items.length === 0 ? (
                <EmptyState
                  searching={searching}
                  query={query}
                  loc={loc}
                  firstRun={!hasAnyFile && loc.kind === 'folder' && loc.id === null && !folderPage?.folders.length && !!anyPage}
                  onSearchAll={serverSearch && canNarrow(loc) && !searchAll ? () => setSearchAll(true) : undefined}
                  onUpload={() => uploadInput.current?.click()}
                  onNew={() => setNaming({ kind: 'file', opt: NEW_FILES[1] })}
                  onNewFolder={() => setNaming({ kind: 'folder' })}
                />
              ) : serverSearch ? (
                <>
                  {sections.exact.length > 0 && renderItems(sections.exact)}
                  {sections.fuzzy.length > 0 && (
                    <>
                      <p className="border-y border-border/40 bg-muted/30 px-4 py-1.5 text-[12px] font-medium text-muted-foreground">
                        {sections.exact.length ? 'Close matches' : `No exact matches — close matches for “${found.data?.query ?? query.trim()}”`}
                      </p>
                      {renderItems(sections.fuzzy)}
                    </>
                  )}
                  {found.data?.note && <p className="px-4 py-3 text-[12px] text-muted-foreground">{found.data.note}</p>}
                </>
              ) : (
                renderItems(items)
              )}

              {docs.hasNextPage && !serverSearch && (
                <div className="flex justify-center py-4">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void docs.fetchNextPage();
                    }}
                    disabled={docs.isFetchingNextPage}
                    className="rounded-md border border-border/60 px-3 py-1.5 text-[12.5px] hover:bg-muted"
                  >
                    {docs.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
              {folderPage?.truncated && inFolder && (
                <p className="px-4 pb-3 text-[12px] text-muted-foreground">Showing the first {folderPage.count} folders here.</p>
              )}
              {osDrop && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg">
                    Drop to upload to {title}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Status bar */}
          {listing && (
            <div className="flex shrink-0 items-center gap-3 border-t border-border/60 bg-card px-3 py-1 text-[11.5px] text-muted-foreground">
              <span>{items.length.toLocaleString()} item{items.length === 1 ? '' : 's'}{docs.hasNextPage ? '+' : ''}</span>
              {selectedItems.length > 0 && (
                <span>
                  {selectedItems.length} selected{selectedDocs.length ? ` · ${formatSize(selectedSize)}` : ''}
                </span>
              )}
              {clipboard && (
                <span className="truncate">
                  {clipboard.items.length} {clipboard.mode === 'cut' ? 'cut' : 'copied'} — paste into a folder
                </span>
              )}
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            </div>
          )}
        </section>

        {/* Preview pane */}
        {listing && showPreview && (
          <aside className="hidden w-80 shrink-0 flex-col border-l border-border/60 bg-card lg:flex xl:w-96">
            <PreviewPane
              item={single}
              count={selectedItems.length}
              onOpen={(i) => openItem(i)}
              onPreview={(d) => setPreviewDoc(d)}
            />
          </aside>
        )}
      </div>

      <input
        ref={uploadInput}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files);
          e.target.value = '';
        }}
      />

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}

      {naming && (
        <NameDialog
          title={naming.kind === 'folder' ? 'New folder' : `New ${naming.opt.label.toLowerCase()}`}
          initial={naming.kind === 'folder' ? 'New folder' : `Untitled.${naming.opt.ext}`}
          busy={busy}
          onSubmit={(name) => void create(name)}
          onCancel={() => setNaming(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={confirmDelete.length === 1 ? 'Move to Trash?' : `Move ${confirmDelete.length} items to Trash?`}
          body={
            confirmDelete.length === 1
              ? `“${confirmDelete[0].kind === 'folder' ? `${confirmDelete[0].folder.name}” and everything in it` : `${confirmDelete[0].doc.filename}”`} will be moved to Trash. You can restore it later.`
              : 'They will be moved to Trash, folders with everything in them. You can restore them later.'
          }
          confirmLabel="Move to Trash"
          busy={busy}
          onConfirm={() => void remove(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      <FolderPickerModal
        isOpen={!!movePicker}
        excludeFolderIds={(movePicker ?? []).flatMap((i) => (i.kind === 'folder' ? [i.folder.id] : []))}
        isBusy={busy}
        onCancel={() => setMovePicker(null)}
        onConfirm={(target) => movePicker && void move(movePicker, target)}
      />

      {properties && (
        <PropertiesDialog
          item={properties}
          location={loc.kind === 'folder' ? ['Home', ...breadcrumbs.map((b) => b.name), ...(currentFolder ? [currentFolder.name] : [])].join(' / ') : title}
          onClose={() => setProperties(null)}
        />
      )}

      {shareDoc && (
        <ConfirmDialog
          title="Share to the public library?"
          body={`Everyone on the platform will be able to find and read “${shareDoc.filename}”. Make sure it has no private or sensitive information and that you have the right to share it.`}
          confirmLabel="Share"
          danger={false}
          onConfirm={() => void toggleShare(shareDoc, true)}
          onCancel={() => setShareDoc(null)}
        />
      )}

      {previewDoc && (
        <DocumentPreviewModal key={previewDoc.id} doc={previewDoc} onClose={() => setPreviewDoc(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function Cmd({
  label, icon: I, onClick, disabled, wide,
}: { label: string; icon: typeof Eye; onClick: () => void; disabled?: boolean; wide?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-foreground/80 hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
    >
      <I className="h-4 w-4" />
      <span className={cn(wide ? 'hidden md:inline' : 'hidden xl:inline')}>{label}</span>
    </button>
  );
}

function Crumb({
  label, icon, onClick, onDrop, current,
}: { label: string; icon?: React.ReactNode; onClick?: () => void; onDrop?: () => void; current?: boolean }) {
  const [over, setOver] = useState(false);
  return (
    <span className="flex min-w-0 items-center">
      {!icon && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />}
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        onDragOver={(e) => {
          if (!onDrop) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onDrop?.();
        }}
        aria-current={current ? 'page' : undefined}
        className={cn(
          'flex min-w-0 items-center gap-1 truncate rounded px-1.5 py-0.5',
          current ? 'font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          !onClick && 'cursor-default hover:bg-transparent',
          over && 'bg-primary/20 ring-1 ring-primary',
        )}
        title={label}
      >
        {icon}
        <span className="truncate">{label}</span>
      </button>
    </span>
  );
}

function EmptyState({
  searching, query, loc, firstRun, onSearchAll, onUpload, onNew, onNewFolder,
}: {
  searching: boolean;
  query: string;
  loc: Location;
  firstRun: boolean;
  /** Offered when the search was narrowed to a folder and found nothing there. */
  onSearchAll?: () => void;
  onUpload: () => void;
  onNew: () => void;
  onNewFolder: () => void;
}) {
  if (searching) {
    return (
      <div className="px-6 py-20 text-center">
        <Search className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
        <p className="font-medium">No matches for “{query}”</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {query.trim().length < 2 ? 'Keep typing to search names and contents.' : 'No file name or file text matches, and nothing is close.'}
        </p>
        {onSearchAll && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSearchAll();
            }}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-sm hover:bg-muted"
          >
            <Search className="h-4 w-4" /> Search all files
          </button>
        )}
      </div>
    );
  }
  if (loc.kind === 'public') {
    return <p className="px-6 py-20 text-center text-sm text-muted-foreground">Nobody has shared a file to the public library yet.</p>;
  }
  if (loc.kind === 'recent') {
    return <p className="px-6 py-20 text-center text-sm text-muted-foreground">No files yet — anything you upload, create, or ask an agent to make shows up here.</p>;
  }
  if (firstRun) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center px-6 py-20 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 rounded-full bg-muted p-5">
          <FolderIcon className="h-10 w-10 text-muted-foreground/50" />
        </div>
        <h3 className="mb-1 text-lg font-semibold">Your files live here</h3>
        <p className="mb-6 text-sm text-muted-foreground">
          Upload documents, create new ones, or ask the assistant to make one — files agents write appear here too.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" onClick={onUpload} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            <Upload className="h-4 w-4" /> Upload files
          </button>
          <button type="button" onClick={onNew} className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-2 text-sm hover:bg-muted">
            <FilePlus2 className="h-4 w-4" /> New document
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="px-6 py-20 text-center" onClick={(e) => e.stopPropagation()}>
      <p className="text-sm text-muted-foreground">This folder is empty.</p>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        Drop files here,{' '}
        <button type="button" onClick={onUpload} className="text-primary hover:underline">upload</button>,{' '}
        <button type="button" onClick={onNew} className="text-primary hover:underline">create a document</button>, or{' '}
        <button type="button" onClick={onNewFolder} className="text-primary hover:underline">add a folder</button>.
      </p>
    </div>
  );
}

function PreviewPane({
  item, count, onOpen, onPreview,
}: {
  item: Item | null;
  count: number;
  onOpen: (i: Item) => void;
  onPreview: (d: Document) => void;
}) {
  if (!item) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-sm text-muted-foreground">
        <Eye className="mb-2 h-6 w-6 opacity-40" />
        {count > 1 ? `${count} items selected` : 'Select a file to preview it here.'}
      </div>
    );
  }
  if (item.kind === 'folder') {
    const f = item.folder;
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <FolderIcon className="h-14 w-14 fill-amber-400/80 text-amber-500" />
        <p className="font-medium">{f.name}</p>
        <p className="text-[12.5px] text-muted-foreground">{f.document_count} files · {f.child_count} folders</p>
        <button type="button" onClick={() => onOpen(item)} className="mt-2 rounded-md border border-border/60 px-3 py-1.5 text-[13px] hover:bg-muted">
          Open folder
        </button>
      </div>
    );
  }
  const d = item.doc;
  if (d.id < 0) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</div>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="shrink-0 border-b border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground" title={formatDateTime(d.updated_at)}>
        {typeName(d)} · {formatSize(d.file_size)} · {formatDate(d.updated_at)}
      </p>
      <PreviewFrame
        doc={d}
        extra={
          <button type="button" onClick={() => onPreview(d)} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 px-2 py-1.5 text-[12px] hover:bg-muted">
            <Eye className="h-3.5 w-3.5" /> Full preview
          </button>
        }
      >
        <FilePreview key={d.id} doc={d} className="min-h-0 flex-1 overflow-auto" />
      </PreviewFrame>
    </div>
  );
}

function TrashView({
  loading, folders, docs, days, onRestore,
}: {
  loading: boolean;
  folders: Folder[];
  docs: Document[];
  days: number;
  onRestore: (p: { folder_ids?: number[]; document_ids?: number[] }) => void;
}) {
  if (loading) {
    return <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }
  if (!folders.length && !docs.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <Trash2 className="mb-3 h-10 w-10 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">Trash is empty.</p>
      </div>
    );
  }
  const row = (key: string, name: string, kind: string, deleted: string | null | undefined, onClick: () => void, I: typeof Eye, tint: string) => (
    <tr key={key} className="hover:bg-muted/60">
      <td className="py-1.5 pl-4 pr-2">
        <span className="flex min-w-0 items-center gap-2"><I className={cn('h-4 w-4 shrink-0', tint)} /><span className="truncate">{name}</span></span>
      </td>
      <td className="hidden px-3 text-muted-foreground sm:table-cell">{kind}</td>
      <td className="px-3 text-muted-foreground">{formatDate(deleted)}</td>
      <td className="pr-3 text-right">
        <button type="button" onClick={onClick} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] hover:bg-muted">
          <RotateCcw className="h-3.5 w-3.5" /> Restore
        </button>
      </td>
    </tr>
  );
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <p className="px-4 py-2 text-[12.5px] text-muted-foreground">Items here are removed permanently after {days} days.</p>
      <table className="w-full table-fixed text-[13px]">
        <colgroup><col /><col className="hidden w-40 sm:table-column" /><col className="w-32" /><col className="w-28" /></colgroup>
        <thead className="text-[12px] text-muted-foreground">
          <tr>
            <th className="py-1.5 pl-4 text-left font-medium">Name</th>
            <th className="hidden px-3 text-left font-medium sm:table-cell">Type</th>
            <th className="px-3 text-left font-medium">Deleted</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {folders.map((f) => row(`f${f.id}`, f.name, 'File folder', f.deleted_at, () => onRestore({ folder_ids: [f.id] }), FolderIcon, 'text-amber-500'))}
          {docs.map((d) => row(`d${d.id}`, d.filename || d.title, typeName(d), d.deleted_at, () => onRestore({ document_ids: [d.id] }), fileIcon(d), fileTint(d)))}
        </tbody>
      </table>
    </div>
  );
}
