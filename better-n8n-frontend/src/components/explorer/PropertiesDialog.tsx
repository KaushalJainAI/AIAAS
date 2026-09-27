/** "Properties" for a file or a folder — what a desktop shows under right-click. */
import { Folder as FolderIcon } from 'lucide-react';

import type { Item } from '../../lib/explorer';
import { appsForDoc } from '../../lib/apps';
import { formatDateTime, formatSize, locationOf, typeName } from '../../lib/fileDisplay';
import FileIcon from '../files/FileIcon';
import { Button } from '../ui/Button';
import { Modal, ModalFooter } from '../ui/Modal';

export default function PropertiesDialog({ item, location, onClose }: { item: Item; location: string; onClose: () => void }) {
  const rows: [string, string][] =
    item.kind === 'folder'
      ? [
          ['Type', 'File folder'],
          ['Location', location],
          ['Contains', `${item.folder.document_count} files, ${item.folder.child_count} folders`],
          ['Created', formatDateTime(item.folder.created_at)],
          ['Modified', formatDateTime(item.folder.updated_at)],
        ]
      : [
          ['Type', typeName(item.doc)],
          ['Opens with', appsForDoc(item.doc).map((a) => a.title).join(', ') || 'Download only'],
          ['Location', locationOf(item.doc)],
          ['Size', `${formatSize(item.doc.file_size)} (${(item.doc.file_size ?? 0).toLocaleString()} bytes)`],
          ['Created', formatDateTime(item.doc.created_at)],
          ['Modified', formatDateTime(item.doc.updated_at)],
          ['Status', statusLabel(item.doc.status)],
          ['Made by', item.doc.metadata?.created_by === 'agent' ? 'An agent' : item.doc.metadata?.created_by === 'user' ? 'You, in the browser' : 'Upload'],
          ['Shared', item.doc.is_shared ? 'Yes — in the public library' : 'No'],
          ...(item.doc.chunk_count ? [['Search index', `${item.doc.chunk_count} chunks`] as [string, string]] : []),
        ];
  const name = item.kind === 'folder' ? item.folder.name : item.doc.filename;
  return (
    <Modal size="sm" label={`Properties of ${name}`} onClose={onClose}>
      <div className="p-6">
        <div className="mb-4 flex items-center gap-3">
          {item.kind === 'folder' ? (
            <FolderIcon className="h-9 w-9 shrink-0 fill-amber-400/80 text-amber-500" />
          ) : (
            <FileIcon doc={item.doc} className="h-9 w-9" />
          )}
          <h3 className="min-w-0 break-words text-base font-semibold">{name}</h3>
        </div>
        <dl className="m-0 grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[13px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="m-0 min-w-0 break-words">{v || '—'}</dd>
            </div>
          ))}
        </dl>
      </div>
      <ModalFooter>
        <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
      </ModalFooter>
    </Modal>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case 'indexed': return 'Indexed for search';
    case 'stored': return 'Stored';
    case 'pending': return 'Queued for indexing';
    case 'processing': return 'Indexing…';
    case 'failed': return 'Processing failed';
    default: return status;
  }
}
