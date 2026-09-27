/**
 * The file browser's navigation pane: quick access, the folder tree, and the
 * places that are not folders (Public library, Extraction, Trash).
 *
 * The tree loads a level when it is expanded, through the same
 * `['folders', id]` query the listing uses, so opening a folder in either
 * place warms the other. It auto-expands along the current location so the
 * folder you are in is always visible in it. Every folder row is a drop
 * target, like the address bar.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen, ChevronRight, Clock, Folder as FolderIcon, FolderOpen, Home, ScanText, Trash2,
} from 'lucide-react';

import { foldersService, type Folder } from '../../api/documents';
import { sameLocation, type Location } from '../../lib/explorer';
import { cn } from '../../lib/utils';

interface Props {
  location: Location;
  /** Ids from the root down to the current folder, so the tree can open along it. */
  trail: number[];
  onNavigate: (loc: Location) => void;
  onDropOn: (folderId: number | null) => void;
  canDrop: boolean;
}

export default function NavPane({ location, trail, onNavigate, onDropOn, canDrop }: Props) {
  // What the user opened or closed by hand; anything else is open when it is
  // Home or on the way to where they are, so the current folder is always in
  // view without an effect copying the trail into state.
  const [toggled, setToggled] = useState<Map<number | null, boolean>>(() => new Map());
  const onPath = new Set<number | null>([null, ...trail]);
  const isOpen = (id: number | null) => toggled.get(id) ?? onPath.has(id);
  const toggle = (id: number | null) =>
    setToggled((prev) => new Map(prev).set(id, !(prev.get(id) ?? onPath.has(id))));

  const place = (loc: Location, label: string, Icon: typeof Home) => (
    <button
      type="button"
      onClick={() => onNavigate(loc)}
      aria-current={sameLocation(location, loc)}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]',
        sameLocation(location, loc) ? 'bg-primary/10 font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" /> {label}
    </button>
  );

  return (
    <nav className="flex min-h-0 flex-col gap-3 overflow-auto p-2" aria-label="Folders">
      <div>
        <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/80">Quick access</p>
        {place({ kind: 'recent' }, 'Recent', Clock)}
      </div>
      <div>
        <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/80">My files</p>
        <TreeNode
          id={null}
          name="Home"
          depth={0}
          hasChildren
          location={location}
          isOpen={isOpen}
          onToggle={toggle}
          onNavigate={onNavigate}
          onDropOn={onDropOn}
          canDrop={canDrop}
        />
      </div>
      <div>
        <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/80">More</p>
        {place({ kind: 'public' }, 'Public library', BookOpen)}
        {place({ kind: 'extraction' }, 'Extraction', ScanText)}
        {place({ kind: 'trash' }, 'Trash', Trash2)}
      </div>
    </nav>
  );
}

function TreeNode({
  id, name, depth, hasChildren, location, isOpen, onToggle, onNavigate, onDropOn, canDrop,
}: {
  id: number | null;
  name: string;
  depth: number;
  hasChildren: boolean;
  location: Location;
  isOpen: (id: number | null) => boolean;
  onToggle: (id: number | null) => void;
  onNavigate: (loc: Location) => void;
  onDropOn: (id: number | null) => void;
  canDrop: boolean;
}) {
  const open = isOpen(id);
  const [over, setOver] = useState(false);
  const { data } = useQuery({
    queryKey: ['folders', id],
    queryFn: () => foldersService.list(id),
    enabled: open && hasChildren,
    staleTime: 60_000,
  });
  const active = location.kind === 'folder' && location.id === id;
  const children: Folder[] = data?.folders ?? [];
  const Icon = id === null ? Home : open ? FolderOpen : FolderIcon;

  return (
    <div>
      <div
        onDragOver={(e) => {
          if (!canDrop) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onDropOn(id);
        }}
        className={cn(
          'flex items-center rounded-md',
          active ? 'bg-primary/10' : 'hover:bg-muted',
          over && 'bg-primary/20 ring-1 ring-primary',
        )}
        style={{ paddingLeft: depth * 12 }}
      >
        <button
          type="button"
          onClick={() => onToggle(id)}
          aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
          className={cn('rounded p-1 text-muted-foreground', !hasChildren && 'invisible')}
        >
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
        </button>
        <button
          type="button"
          onClick={() => onNavigate({ kind: 'folder', id })}
          aria-current={active}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-2 text-left text-[13px]',
            active ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className={cn('h-4 w-4 shrink-0', id === null ? '' : 'text-amber-500')} />
          <span className="truncate">{name}</span>
        </button>
      </div>
      {open && children.map((f) => (
        <TreeNode
          key={f.id}
          id={f.id}
          name={f.name}
          depth={depth + 1}
          hasChildren={f.child_count > 0}
          location={location}
          isOpen={isOpen}
          onToggle={onToggle}
          onNavigate={onNavigate}
          onDropOn={onDropOn}
          canDrop={canDrop}
        />
      ))}
    </div>
  );
}
