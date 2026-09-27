/**
 * The file browser's content area in its three layouts — Details (sortable
 * columns), Tiles (large icons, image thumbnails) and List (compact names).
 *
 * Purely presentational: selection, renaming and drag state live in the page,
 * which owns the rules (`lib/explorer.ts`). Every row takes the same pointer
 * contract in all three layouts — click selects, Ctrl/Shift extend,
 * double-click opens, right-click opens the menu, dragging moves — so the
 * layout is a matter of taste, never of what you can do.
 */
import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { ArrowDown, ArrowUp, Folder as FolderIcon, Loader2, MoreVertical } from 'lucide-react';

import type { Document } from '../../api/documents';
import { keyOf, nameOf, stemLength, type Item, type Sort, type SortKey } from '../../lib/explorer';
import { formatDate, formatSize, locationOf, typeName } from '../../lib/fileDisplay';
import { cn } from '../../lib/utils';
import { useBlobUrl } from '../../hooks/useBlobUrl';
import FileIcon from '../files/FileIcon';

export type ViewMode = 'details' | 'tiles' | 'list';

interface Props {
  items: Item[];
  view: ViewMode;
  sort: Sort;
  onSort: (key: SortKey) => void;
  selected: Set<string>;
  cut: Set<string>;
  renaming: string | null;
  /** An extra column: where a file lives (Recent, search) or who shared it (public library). */
  showLocation?: 'path' | 'author';
  /** A muted line under a row's name — a search snippet, or where a folder hit lives. Plain text. */
  subtitle?: (item: Item) => string | undefined;
  /** False while the order is the server's relevance ranking: headers stop sorting. */
  sortable?: boolean;
  onItemClick: (item: Item, e: MouseEvent) => void;
  onItemOpen: (item: Item) => void;
  onItemMenu: (item: Item, e: MouseEvent) => void;
  onRename: (item: Item, name: string) => void;
  onRenameCancel: () => void;
  onDragStart: (item: Item, e: DragEvent) => void;
  onDragEnd: () => void;
  onDropOnFolder: (folderId: number) => void;
  canDrop: boolean;
}

export default function ItemsView(props: Props) {
  const { items, view } = props;
  if (view === 'details') return <DetailsView {...props} />;
  return (
    <ul
      className={cn(
        'm-0 grid list-none gap-1 p-2',
        view === 'tiles'
          ? 'grid-cols-[repeat(auto-fill,minmax(112px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(128px,1fr))]'
          : 'grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]',
      )}
      role="listbox"
      aria-multiselectable
    >
      {items.map((item) => (
        <ItemShell key={keyOf(item)} item={item} {...props} as="li">
          {view === 'tiles' ? (
            <div className="flex flex-col items-center gap-1.5 px-1 py-2 text-center">
              <Thumb item={item} />
              <NameCell item={item} {...props} center />
            </div>
          ) : (
            <div className="flex items-center gap-2 px-2 py-1">
              <ItemIcon item={item} className="h-4 w-4" />
              <NameCell item={item} {...props} />
            </div>
          )}
        </ItemShell>
      ))}
    </ul>
  );
}

function DetailsView(props: Props) {
  const { items, sort, onSort, showLocation, sortable = true } = props;
  const header = (key: SortKey | null, label: string, className?: string) => (
    <th className={cn('sticky top-0 z-10 bg-card px-2 py-1.5 text-left font-medium', className)}>
      {key && sortable ? (
        <button
          type="button"
          onClick={() => onSort(key)}
          className="inline-flex items-center gap-1 rounded px-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {label}
          {sort.key === key && (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
        </button>
      ) : (
        <span className="px-1 text-muted-foreground">{label}</span>
      )}
    </th>
  );
  return (
    <table
      className={cn(
        'w-full table-fixed border-separate border-spacing-0 text-[13px]',
        // Minimum widths per visible-column set so the table scrolls
        // horizontally (the pane has overflow-auto) instead of crushing the
        // flexible Name column to ~0 — a crushed Name left its shrink-0 file
        // icon overflowing visibly into the next cell, painting over the
        // "Shared by" author text.
        'min-w-[320px] sm:min-w-[480px] md:min-w-[660px]',
        showLocation ? 'lg:min-w-[840px]' : 'lg:min-w-[660px]',
      )}
      role="grid"
      aria-multiselectable
    >
      <colgroup>
        <col />
        {showLocation && <col className="hidden w-48 lg:table-column" />}
        <col className="w-28 sm:w-40" />
        <col className="hidden w-44 md:table-column" />
        <col className="hidden w-24 sm:table-column" />
        <col className="w-10" />
      </colgroup>
      <thead className="border-b border-border/60 text-[12px]">
        <tr>
          {header('name', 'Name', 'pl-4')}
          {showLocation && header(null, showLocation === 'author' ? 'Shared by' : 'Location', 'hidden lg:table-cell')}
          {header('modified', 'Date modified')}
          {header('type', 'Type', 'hidden md:table-cell')}
          {header('size', 'Size', 'hidden text-right sm:table-cell')}
          <th className="sticky top-0 z-10 bg-card" aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <ItemShell key={keyOf(item)} item={item} {...props} as="tr">
            <td className="overflow-hidden py-1 pl-4 pr-2">
              <div className="flex min-w-0 items-center gap-2">
                <ItemIcon item={item} className="h-4 w-4" />
                <NameCell item={item} {...props} />
              </div>
            </td>
            {showLocation && (
              <td className="hidden truncate px-3 text-muted-foreground lg:table-cell">
                {item.kind !== 'doc' ? '' : showLocation === 'author' ? (item.doc.author_name ?? '') : locationOf(item.doc)}
              </td>
            )}
            <td className="truncate px-3 text-muted-foreground">
              {formatDate(item.kind === 'folder' ? item.folder.updated_at : item.doc.updated_at)}
            </td>
            <td className="hidden truncate px-3 text-muted-foreground md:table-cell">
              {item.kind === 'folder' ? 'File folder' : typeName(item.doc)}
            </td>
            <td className="hidden truncate px-3 text-right tabular-nums text-muted-foreground sm:table-cell">
              {item.kind === 'doc' ? formatSize(item.doc.file_size) : ''}
            </td>
            <td className="pr-2 text-right">
              <button
                type="button"
                aria-label={`More actions for ${nameOf(item)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onItemMenu(item, e);
                }}
                className="rounded p-1 text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </td>
          </ItemShell>
        ))}
      </tbody>
    </table>
  );
}

/** The row/tile wrapper: selection highlight, pointer handlers and drop target. */
function ItemShell({
  item, as, children, selected, cut, onItemClick, onItemOpen, onItemMenu, onDragStart, onDragEnd,
  onDropOnFolder, canDrop, renaming,
}: Props & { item: Item; as: 'li' | 'tr'; children: React.ReactNode }) {
  const [over, setOver] = useState(false);
  const key = keyOf(item);
  const isSelected = selected.has(key);
  const busy = item.kind === 'doc' && item.doc.status === 'uploading';
  const Tag = as;
  return (
    <Tag
      data-key={key}
      role={as === 'li' ? 'option' : 'row'}
      aria-selected={isSelected}
      draggable={!busy && renaming !== key}
      onDragStart={(e: DragEvent) => onDragStart(item, e)}
      onDragEnd={onDragEnd}
      onDragOver={(e: DragEvent) => {
        if (item.kind !== 'folder' || !canDrop || isSelected) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e: DragEvent) => {
        if (item.kind !== 'folder') return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        onDropOnFolder(item.folder.id);
      }}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onItemClick(item, e);
      }}
      onDoubleClick={() => !busy && onItemOpen(item)}
      onContextMenu={(e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onItemMenu(item, e);
      }}
      className={cn(
        'group cursor-default select-none rounded-md outline-none',
        as === 'tr' && '[&>td:first-child]:rounded-l-md [&>td:last-child]:rounded-r-md',
        isSelected ? 'bg-primary/15 [&>td]:bg-primary/15' : 'hover:bg-muted/70 [&>td]:hover:bg-muted/70',
        over && 'bg-primary/25 ring-1 ring-primary [&>td]:bg-primary/25',
        cut.has(key) && 'opacity-50',
        busy && 'opacity-60',
      )}
    >
      {children}
    </Tag>
  );
}

function ItemIcon({ item, className }: { item: Item; className?: string }) {
  if (item.kind === 'folder') return <FolderIcon className={cn('shrink-0 fill-amber-400/80 text-amber-500', className)} />;
  if (item.doc.status === 'uploading') return <Loader2 className={cn('shrink-0 animate-spin text-primary', className)} />;
  return <FileIcon doc={item.doc} className={className} />;
}

function NameCell({
  item, renaming, onRename, onRenameCancel, center, subtitle,
}: Props & { item: Item; center?: boolean }) {
  const key = keyOf(item);
  const name = nameOf(item);
  if (renaming === key) {
    return <RenameInput name={name} isFile={item.kind === 'doc'} onCommit={(v) => onRename(item, v)} onCancel={onRenameCancel} center={center} />;
  }
  const status = item.kind === 'doc' ? item.doc.status : null;
  const note = subtitle?.(item);
  return (
    <span className={cn('min-w-0', center ? 'w-full' : 'flex-1')}>
      <span className={cn('block text-foreground', center ? 'line-clamp-2 break-words text-[12.5px]' : 'truncate')} title={name}>
        {name}
      </span>
      {note && (
        <span className={cn('block text-[11px] text-muted-foreground', center ? 'line-clamp-2 break-words' : 'truncate')} title={note}>
          {note}
        </span>
      )}
      {(status === 'pending' || status === 'processing') && (
        <span className="block text-[10.5px] text-warning">Indexing…</span>
      )}
      {status === 'failed' && <span className="block text-[10.5px] text-destructive">Processing failed</span>}
    </span>
  );
}

function RenameInput({
  name, isFile, onCommit, onCancel, center,
}: { name: string; isFile: boolean; onCommit: (v: string) => void; onCancel: () => void; center?: boolean }) {
  const [value, setValue] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, isFile ? stemLength(name) : name.length);
  }, [name, isFile]);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    const v = value.trim();
    if (v && v !== name) onCommit(v);
    else onCancel();
  };
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') {
          done.current = true;
          onCancel();
        }
      }}
      onBlur={commit}
      aria-label="New name"
      className={cn(
        'min-w-0 flex-1 rounded border border-primary bg-background px-1 py-0.5 text-[13px] outline-none',
        center && 'w-full text-center',
      )}
    />
  );
}

/** A tile's picture: a real thumbnail for images once the tile is on screen. */
function Thumb({ item }: { item: Item }) {
  const isImage = item.kind === 'doc' && item.doc.file_type === 'image' && item.doc.id > 0;
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!isImage || !ref.current) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '200px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [isImage]);
  const { url } = useBlobUrl(isImage && visible ? (item as { doc: Document }).doc.id : null);
  return (
    <div ref={ref} className="flex h-16 w-16 items-center justify-center sm:h-20 sm:w-20">
      {url ? (
        <img src={url} alt="" className="max-h-full max-w-full rounded object-cover shadow-sm" draggable={false} />
      ) : (
        <ItemIcon item={item} className="h-12 w-12 sm:h-14 sm:w-14" />
      )}
    </div>
  );
}
