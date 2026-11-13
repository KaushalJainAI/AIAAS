/**
 * Pure helpers for showing a file: its icon name, type name, size, date and
 * location; and the decisions a preview makes (which kind a file is, how JSON
 * is formatted, what a notebook holds).
 *
 * Copied from the web app with the DOM and React parts removed:
 *   better-n8n-frontend/src/lib/fileDisplay.ts   (fileIcon, fileTint, typeName, formatSize, formatDate, locationOf)
 *   better-n8n-frontend/src/lib/filePreview.ts   (kindOf, legacySentence, formatJson, parseNotebook)
 *   better-n8n-frontend/src/lib/codeLanguage.ts  (languageForFile)
 *   better-n8n-frontend/src/lib/latex.ts         (isLatexFile)
 *
 * Differences from the web:
 * - Icons are lucide icon NAMES (`'file-text'`, `'scroll-text'`), the same
 *   names the web uses, returned as strings. The screen maps a name to an icon
 *   component. Nothing here imports an icon library.
 * - `fileTintName` returns a colour family (`'red'`, `'blue'`, ...) where the web
 *   returned a Tailwind class. The screen maps it to a theme colour.
 * - `downloadDocument` (a browser `<a>` click) is not copied: a mobile download
 *   goes through `downloadDocument` in ./api.ts.
 */
import { extensionOf } from '../apps/catalogue';

/** The part of a document these helpers read. */
export interface Shown {
  filename: string;
  file_type: string;
}

// ---------------------------------------------------------------------------
// Icons and tints
// ---------------------------------------------------------------------------

/** Code file extensions shown with a code icon when stored as text. */
const CODE = new Set([
  'py', 'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'sql', 'yaml', 'yml', 'xml', 'sh', 'go', 'rs',
  'java', 'c', 'cpp', 'cs', 'rb', 'php', 'html', 'htm', 'ipynb',
]);

/** Lucide icon name for a file. */
export function fileIconName(doc: Shown): string {
  const ext = extensionOf(doc.filename);
  switch (doc.file_type) {
    case 'pdf': return 'scroll-text';
    case 'image': return 'file-image';
    case 'video': return 'file-video';
    case 'audio': return 'file-audio';
    case 'xlsx':
    case 'csv': return 'file-spreadsheet';
    case 'pptx': return 'presentation';
    case 'json': return 'file-json';
    case 'html': return 'file-code-2';
    case 'docx':
    case 'md': return 'file-text';
    case 'other': return ext === 'zip' ? 'file-archive' : 'file';
    default: return CODE.has(ext) ? 'file-code-2' : 'file-text';
  }
}

/** Colour family per type, so a list of mixed files scans quickly. */
export type TintName = 'red' | 'pink' | 'fuchsia' | 'green' | 'orange' | 'blue' | 'sky' | 'violet' | 'muted';

export function fileTintName(doc: Shown): TintName {
  switch (doc.file_type) {
    case 'pdf': return 'red';
    case 'image': return 'pink';
    case 'video':
    case 'audio': return 'fuchsia';
    case 'xlsx':
    case 'csv': return 'green';
    case 'pptx': return 'orange';
    case 'docx': return 'blue';
    case 'md': return 'sky';
    case 'json':
    case 'html': return 'violet';
    default: return 'muted';
  }
}

// ---------------------------------------------------------------------------
// Names, sizes, dates, places
// ---------------------------------------------------------------------------

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
export function locationOf(doc: { folder_path?: string | null }): string {
  const p = (doc.folder_path ?? '').replace(/\/+$/, '');
  return p && p !== '/' ? p : 'Home';
}

// ---------------------------------------------------------------------------
// Preview kind
// ---------------------------------------------------------------------------

export type PreviewKind =
  | 'markdown' | 'csv' | 'json' | 'html' | 'notebook' | 'latex' | 'code' | 'text' | 'media' | 'office'
  | 'pdf' | 'legacy_office' | 'converted_image' | 'archive' | 'email' | 'opendocument';

/** Types whose bytes are a zip of XML: previewed from their stored spec or extract, never read as text. */
const OFFICE_TYPES = new Set(['pptx', 'xlsx', 'docx']);

/** Old Office binaries: the new-format libraries cannot read them. */
const LEGACY_OFFICE_EXTS = new Set(['doc', 'xls', 'ppt']);
const LEGACY_OFFICE_TYPES = new Set(['doc_legacy', 'xls_legacy', 'ppt_legacy']);

/** Images most browsers and phones cannot display: converted server-side to PNG. */
const CONVERTIBLE_IMAGE_EXTS = new Set(['tif', 'tiff', 'bmp', 'heic', 'heif']);

/** The modern equivalent a legacy file can be re-saved as. */
const LEGACY_TARGET: Record<string, string> = { doc: '.docx', xls: '.xlsx', ppt: '.pptx' };

/** The extension, lowercased, or '' when there is none. */
export function extensionOfDoc(doc: Shown): string {
  const name = doc.filename || '';
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}

/** `.tex`, `.latex`, `.ltx`: a LaTeX source, whatever its row says. */
export function isLatexFile(filename: string): boolean {
  return /\.(tex|latex|ltx)$/i.test(filename);
}

/** How to show a document, from its extension first and then its type. */
export function kindOf(doc: Shown): PreviewKind {
  const type = (doc.file_type || '').toLowerCase();
  const ext = extensionOfDoc(doc);
  // Extension first: an old row may still call a `.doc` file `docx`, and a
  // `.py` arrives as `txt` — the name is the finer signal either way.
  if (ext === 'pdf' || type === 'pdf') return 'pdf';
  // Ahead of the `other` check below: a `.tex` stored as `other` is still text.
  if (isLatexFile(doc.filename || '')) return 'latex';
  if (LEGACY_OFFICE_EXTS.has(ext) || LEGACY_OFFICE_TYPES.has(type)) return 'legacy_office';
  if (CONVERTIBLE_IMAGE_EXTS.has(ext)) return 'converted_image';
  if (ext === 'zip' || type === 'zip') return 'archive';
  if (ext === 'eml' || type === 'eml') return 'email';
  if (ext === 'odt' || ext === 'ods' || ext === 'odp'
    || type === 'odt' || type === 'ods' || type === 'odp') return 'opendocument';
  // `audio` and `other` join the media view: an icon and a download, never
  // unknown bytes rendered as text.
  if (['image', 'video', 'audio', 'other'].includes(type)) return 'media';
  // Before the extension checks below, because a .docx read as text is zip noise.
  if (OFFICE_TYPES.has(type) || OFFICE_TYPES.has(ext)) return 'office';

  if (ext === 'ipynb') return 'notebook';
  if (ext === 'md' || ext === 'markdown' || type === 'md') return 'markdown';
  if (ext === 'csv' || ext === 'tsv' || type === 'csv') return 'csv';
  if (ext === 'json' || type === 'json') return 'json';
  if (ext === 'html' || ext === 'htm' || type === 'html') return 'html';
  if (languageForFile(doc.filename)) return 'code';
  return 'text';
}

/** What the preview says for an old Office binary (mirrors the backend). */
export function legacySentence(doc: Shown): string {
  const ext = extensionOfDoc(doc);
  const label = ext === 'doc' ? 'Word 97–2003' : ext === 'xls' ? 'Excel 97–2003'
    : ext === 'ppt' ? 'PowerPoint 97–2003' : 'old Office';
  const target = LEGACY_TARGET[ext];
  return `Old Office format (${label}). Download to open it`
    + (target ? `, or re-save as ${target} to edit it here.` : '.');
}

/** `text` re-indented when it parses as JSON; null when it does not. */
export function formatJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Code grammar
// ---------------------------------------------------------------------------

/**
 * Highlighter grammar for a fence tag or a bare extension. Unknown is null,
 * which means plain text rather than a guess.
 */
const ALIASES: Record<string, string> = {
  py: 'python', python: 'python', ipynb: 'python',
  js: 'javascript', javascript: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', typescript: 'typescript', tsx: 'typescript',
  json: 'json', jsonl: 'json',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  css: 'css', scss: 'css',
  sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  sql: 'sql',
  yml: 'yaml', yaml: 'yaml',
  md: 'markdown', markdown: 'markdown',
  go: 'go',
  rs: 'rust', rust: 'rust',
  java: 'java',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', hpp: 'cpp', 'c++': 'cpp',
  cs: 'csharp', csharp: 'csharp',
  rb: 'ruby', ruby: 'ruby',
  php: 'php',
  kt: 'kotlin', kotlin: 'kotlin',
  swift: 'swift',
  r: 'r',
  toml: 'ini', ini: 'ini', cfg: 'ini', env: 'ini',
  dockerfile: 'dockerfile', docker: 'dockerfile',
  diff: 'diff', patch: 'diff',
  tex: 'latex', latex: 'latex', ltx: 'latex', sty: 'latex', cls: 'latex', bib: 'latex',
};

/** Grammar for a fence tag or a bare extension; null when there is none. */
export function languageFor(tag: string | null | undefined): string | null {
  if (!tag) return null;
  return ALIASES[tag.trim().toLowerCase()] ?? null;
}

/** Grammar for a filename, by extension (or the whole name, for `Dockerfile`). */
export function languageForFile(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (lower === 'dockerfile' || lower.endsWith('.dockerfile')) return 'dockerfile';
  const dot = lower.lastIndexOf('.');
  return dot < 0 ? null : languageFor(lower.slice(dot + 1));
}

// ---------------------------------------------------------------------------
// Notebooks
// ---------------------------------------------------------------------------

export type NotebookOutput =
  | { kind: 'text'; text: string; error?: boolean }
  | { kind: 'image'; src: string };

export interface NotebookCell {
  type: 'code' | 'markdown' | 'raw';
  source: string;
  executionCount: number | null;
  outputs: NotebookOutput[];
}

export interface Notebook {
  language: string | null;
  cells: NotebookCell[];
}

const joinSource = (s: unknown): string =>
  Array.isArray(s) ? s.map(String).join('') : typeof s === 'string' ? s : '';

/** Terminal colour codes, which Jupyter tracebacks are full of. */
const ANSI = /\[[0-9;]*[A-Za-z]/g;

/** Image types a notebook may embed and a native `<Image>` may safely show. */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif'] as const;

function readOutput(raw: Record<string, unknown>): NotebookOutput | null {
  const type = raw.output_type;
  if (type === 'stream') {
    return { kind: 'text', text: joinSource(raw.text), error: raw.name === 'stderr' };
  }
  if (type === 'error') {
    const tb = Array.isArray(raw.traceback) ? raw.traceback.map(String).join('\n') : '';
    return { kind: 'text', text: (tb || `${raw.ename}: ${raw.evalue}`).replace(ANSI, ''), error: true };
  }
  if (type === 'execute_result' || type === 'display_data') {
    const data = (raw.data ?? {}) as Record<string, unknown>;
    for (const mime of IMAGE_TYPES) {
      const b64 = joinSource(data[mime]).replace(/\s/g, '');
      // Base64 alphabet only, so the value cannot close the data URL or name another scheme.
      if (b64 && /^[A-Za-z0-9+/=]+$/.test(b64)) return { kind: 'image', src: `data:${mime};base64,${b64}` };
    }
    // `text/html` outputs are not rendered: they would need a sandboxed frame.
    // Their plain-text twin is always present and says what the value was.
    const plain = joinSource(data['text/plain']);
    return plain ? { kind: 'text', text: plain } : null;
  }
  return null;
}

/** A parsed `.ipynb`, or null when the text is not one. */
export function parseNotebook(text: string): Notebook | null {
  let nb: unknown;
  try {
    nb = JSON.parse(text);
  } catch {
    return null;
  }
  if (!nb || typeof nb !== 'object' || !Array.isArray((nb as { cells?: unknown }).cells)) return null;

  const { cells, metadata } = nb as { cells: Record<string, unknown>[]; metadata?: Record<string, unknown> };
  const info = (metadata?.language_info ?? metadata?.kernelspec ?? {}) as { name?: string; language?: string };

  return {
    language: info.language ?? info.name ?? null,
    cells: cells.map((c) => ({
      type: c.cell_type === 'markdown' ? 'markdown' : c.cell_type === 'raw' ? 'raw' : 'code',
      source: joinSource(c.source),
      executionCount: typeof c.execution_count === 'number' ? c.execution_count : null,
      outputs: Array.isArray(c.outputs)
        ? c.outputs.map((o) => readOutput(o as Record<string, unknown>)).filter((o): o is NotebookOutput => o !== null)
        : [],
    })),
  };
}
