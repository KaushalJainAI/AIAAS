/**
 * How a file is shown in a list — its icon, type name, size, date and
 * location. Shared by the file browser and the app workspaces so a file reads
 * the same in both.
 */
import {
  File, FileArchive, FileAudio, FileCode2, FileImage, FileJson, FileSpreadsheet, FileText, FileVideo,
  Presentation, ScrollText, type LucideIcon,
} from 'lucide-react';

import type { Document } from '../api/documents';
import { extensionOf } from './apps';

type Shown = Pick<Document, 'filename' | 'file_type'>;

const CODE = new Set(['py', 'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'sql', 'yaml', 'yml', 'xml', 'sh', 'go', 'rs', 'java', 'c', 'cpp', 'cs', 'rb', 'php', 'html', 'htm', 'ipynb']);

export function fileIcon(doc: Shown): LucideIcon {
  const ext = extensionOf(doc.filename);
  switch (doc.file_type) {
    case 'pdf': return ScrollText;
    case 'image': return FileImage;
    case 'video': return FileVideo;
    case 'audio': return FileAudio;
    case 'xlsx':
    case 'csv': return FileSpreadsheet;
    case 'pptx': return Presentation;
    case 'json': return FileJson;
    case 'html': return FileCode2;
    case 'docx':
    case 'md': return FileText;
    case 'other': return ext === 'zip' ? FileArchive : File;
    default: return CODE.has(ext) ? FileCode2 : FileText;
  }
}

/** Tailwind text colour per type, so a folder of mixed files scans quickly. */
export function fileTint(doc: Shown): string {
  switch (doc.file_type) {
    case 'pdf': return 'text-red-500';
    case 'image': return 'text-pink-500';
    case 'video':
    case 'audio': return 'text-fuchsia-500';
    case 'xlsx':
    case 'csv': return 'text-green-600';
    case 'pptx': return 'text-orange-500';
    case 'docx': return 'text-blue-600';
    case 'md': return 'text-sky-500';
    case 'json':
    case 'html': return 'text-violet-500';
    default: return 'text-muted-foreground';
  }
}

const TYPE_NAMES: Record<string, string> = {
  pdf: 'PDF document', txt: 'Text document', md: 'Markdown document', docx: 'Word document',
  pptx: 'PowerPoint presentation', xlsx: 'Excel workbook', csv: 'CSV file', json: 'JSON file',
  html: 'HTML page', image: 'Image', video: 'Video', audio: 'Audio', other: 'File',
};

/** "Word document", or "PY file" for a code file stored as text. */
export function typeName(doc: Shown): string {
  const ext = extensionOf(doc.filename);
  if (doc.file_type === 'txt' && ext && ext !== 'txt') return `${ext.toUpperCase()} file`;
  if ((doc.file_type === 'image' || doc.file_type === 'video' || doc.file_type === 'audio' || doc.file_type === 'other') && ext) {
    return `${ext.toUpperCase()} ${doc.file_type === 'other' ? 'file' : TYPE_NAMES[doc.file_type].toLowerCase()}`;
  }
  return TYPE_NAMES[doc.file_type] ?? 'File';
}

export function formatSize(bytes: number | null | undefined): string {
  const b = bytes ?? 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Today → a time, this year → day and month, older → a full date. */
export function formatDate(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

/** Where a file lives, for display: `/Chat/reports`, or "Home" for the root. */
export function locationOf(doc: Pick<Document, 'folder_path'>): string {
  const p = (doc.folder_path ?? '').replace(/\/+$/, '');
  return p && p !== '/' ? p : 'Home';
}
