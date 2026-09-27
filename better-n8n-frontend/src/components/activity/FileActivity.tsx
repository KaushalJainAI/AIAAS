/**
 * Recent files & content — what changed, not what is running.
 *
 * Copy/move are synchronous column writes, so there is never a "copying…"
 * live row. Their traces land here instead: opened files, overwritten
 * versions, workspace edits. Hidden when empty.
 */
import { Link } from 'react-router-dom';
import { FileDiff, FolderOpen, GitCommitHorizontal } from 'lucide-react';
import { useActivityFiles } from '../../hooks/useActivityLive';
import type { FileActivityItem } from '../../api/activity';
import { when } from './bits';

function Icon({ kind }: { kind: FileActivityItem['kind'] }) {
  if (kind === 'file_opened') return <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />;
  if (kind === 'file_version') return <FileDiff className="w-4 h-4 text-muted-foreground shrink-0" />;
  return <GitCommitHorizontal className="w-4 h-4 text-muted-foreground shrink-0" />;
}

function sub(item: FileActivityItem): string {
  if (item.kind === 'file_opened') {
    const app = item.app ? ` · in ${item.app}` : '';
    const count = (item.open_count ?? 1) > 1 ? ` · opened ${item.open_count}×` : '';
    return `Opened${app}${count}`;
  }
  if (item.kind === 'file_version') {
    const source = item.source === 'agent' ? 'written by an agent' : item.source === 'restore' ? 'before a restore' : 'edited in an app';
    return `Overwritten — ${source}`;
  }
  return 'Changed by an agent run';
}

export default function FileActivity() {
  const { items, truncated } = useActivityFiles();

  if (items.length === 0) return null;

  return (
    <section className="mb-4 border border-border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <FileDiff className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Recent files</h2>
        <span className="text-[12px] text-muted-foreground tabular-nums">
          {items.length}{truncated && '+'}
        </span>
      </div>
      {items.map((item, i) => (
        <div key={`${item.kind}:${item.document_id ?? item.path ?? item.name}:${i}`} className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-b-0">
          <Icon kind={item.kind} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium truncate" title={item.path ?? item.name}>{item.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {sub(item)}{item.at ? ` · ${when(item.at)}` : ''}
            </p>
          </div>
          <Link
            to={item.href}
            className="px-2.5 py-1.5 text-[12px] rounded border border-border hover:bg-secondary shrink-0"
          >
            Open
          </Link>
        </div>
      ))}
    </section>
  );
}
