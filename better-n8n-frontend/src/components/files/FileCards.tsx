/**
 * The files a turn wrote or edited, as cards under the answer.
 *
 * The model's prose may or may not mention what it saved, and when it does the
 * path is whatever it chose to type. These come from the tool results instead
 * (`chat/turn/agent.py::_on_file`), so every file written gets a card, and the
 * card links by document id rather than by a path that has to be resolved.
 *
 * An edit shows as a diff of what the tool replaced — the old text and the new
 * — because "edited report.md" says nothing about whether the right paragraph
 * changed, and that is the question a person reviewing an agent's work has.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDown, ChevronRight, Download, FileCode2, FilePen, FilePlus2, FileSpreadsheet, FileText, ImageIcon, Presentation,
  type LucideIcon,
} from 'lucide-react';

import type { FileCardData } from '../../api/chat';
import { languageForFile } from '../../lib/codeLanguage';
import { downloadDocument } from '../../lib/filePreview';
import { toast } from '../../lib/toastStore';
import { cn } from '../../lib/utils';
import CodeView from './CodeView';
import { useFilePreview } from './filePreviewState';

/** Rendered files get their format's icon: "Created" says nothing about what it is. */
const TYPE_ICON: Partial<Record<NonNullable<FileCardData['type']>, LucideIcon>> = {
  pptx: Presentation,
  xlsx: FileSpreadsheet,
  docx: FileText,
  image: ImageIcon,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ACTION_LABEL: Record<FileCardData['action'], string> = {
  created: 'Created',
  updated: 'Overwritten',
  appended: 'Appended',
  edited: 'Edited',
};

/** An edit as unified-diff-shaped text, so the `diff` grammar colours it. */
function diffText(edits: NonNullable<FileCardData['edits']>, omitted: number): string {
  const blocks = edits.map((e, i) => {
    const head = `@@ edit ${i + 1}${e.replacements && e.replacements > 1 ? ` · ${e.replacements} places` : ''} @@`;
    const minus = e.old ? e.old.replace(/\n$/, '').split('\n').map((l) => `- ${l}`) : [];
    const plus = e.new ? e.new.replace(/\n$/, '').split('\n').map((l) => `+ ${l}`) : [];
    return [head, ...minus, ...plus].join('\n');
  });
  if (omitted > 0) blocks.push(`@@ ${omitted} more edit${omitted === 1 ? '' : 's'} not shown @@`);
  return blocks.join('\n');
}

function FileCard({ file }: { file: FileCardData }) {
  const openPreview = useFilePreview();
  const [showDiff, setShowDiff] = useState(false);
  const edits = file.edits;
  const diff = useMemo(
    () => (edits?.length ? diffText(edits, file.edits_omitted ?? 0) : ''),
    [edits, file.edits_omitted],
  );

  const Icon = (file.type && TYPE_ICON[file.type])
    ?? (file.action === 'created' ? FilePlus2 : file.action === 'edited' ? FilePen
      : languageForFile(file.name) ? FileCode2 : FileText);
  const href = `/documents?doc=${file.document_id}`;
  const folder = file.path.slice(0, Math.max(0, file.path.lastIndexOf('/'))) || '/';

  return (
    <li className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <div className="flex items-center gap-3 px-3 py-2">
        <Icon className="h-4 w-4 shrink-0 text-primary/80" />
        <Link
          to={href}
          onClick={(e) => {
            // Plain click previews in place; a modified click (new tab,
            // new window) keeps the link's normal behaviour.
            if (!openPreview || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            openPreview({ documentId: file.document_id, path: file.path });
          }}
          className="min-w-0 flex-1 no-underline"
          title={`Open ${file.path}`}
        >
          <span className="block truncate text-sm font-medium text-foreground hover:text-primary">{file.name}</span>
          <span className="block truncate font-mono text-[11px] text-muted-foreground">
            {folder}{file.bytes ? ` · ${formatBytes(file.bytes)}` : ''}
          </span>
        </Link>
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-medium',
            file.action === 'created' ? 'bg-success-subtle text-success' : 'bg-muted text-muted-foreground',
          )}
        >
          {ACTION_LABEL[file.action] ?? 'Saved'}
        </span>
        {file.type && (
          // A rendered file is for taking away: one click Export, not preview-then-download.
          <button
            type="button"
            onClick={() => {
              downloadDocument({ id: file.document_id, filename: file.name, title: file.name })
                .catch(() => toast.error('Could not export that file.'));
            }}
            title={`Export ${file.name}`}
            aria-label={`Export ${file.name}`}
            className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        )}
        {edits && edits.length > 0 && (
          <button
            type="button"
            onClick={() => setShowDiff((v) => !v)}
            aria-expanded={showDiff}
            className="inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {showDiff ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Changes
          </button>
        )}
      </div>
      {showDiff && diff && (
        <div className="max-h-80 overflow-hidden border-t border-border/60 bg-muted/20">
          <CodeView code={diff} language="diff" lineNumbers={false} className="max-h-80" />
        </div>
      )}
    </li>
  );
}

export default function FileCards({ files }: { files: FileCardData[] | undefined }) {
  if (!files?.length) return null;
  return (
    <div className="my-3">
      <div className="mb-1.5 px-1 text-[11px] font-medium text-muted-foreground">
        {files.length === 1 ? '1 file' : `${files.length} files`} saved to your Documents
      </div>
      <ul className="m-0 list-none space-y-1.5 p-0">
        {files.map((f) => (
          <FileCard key={f.document_id} file={f} />
        ))}
      </ul>
    </div>
  );
}
