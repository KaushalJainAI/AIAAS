/**
 * The productivity apps (P5, rebuilt 2026-09-24).
 *
 * One declaration per app: presentation, search keywords, which of the user's
 * files it opens, and what "New" makes. Two kinds:
 *
 * * `workspace` apps open at `/apps/<id>` — the user's matching files on the
 *   left (from anywhere in their tree, agent-written ones included), the
 *   editor on the right. `accepts` is the whole contract: the backend narrows
 *   by `file_type` (`types`) and the extension list narrows further, because
 *   `file_type` is a small closed vocabulary — a `.py` is stored as `txt`.
 * * `route` apps are pages that already exist (Files, Dashboards, Pages,
 *   Imagine) and are listed so the launcher is the one place to find them.
 *
 * `appsForDoc` answers "Open with…" in the file browser from the same table,
 * so a file can never be listed by an app that cannot open it.
 */
import {
  AppWindow,
  CheckSquare,
  Code2,
  FileText,
  Film,
  Folder,
  Globe,
  Image,
  LayoutDashboard,
  NotebookPen,
  PenTool,
  Presentation,
  ScrollText,
  Sparkles,
  Table,
  type LucideIcon,
} from 'lucide-react';

import type { Document } from '../api/documents';

export type EditorKind =
  | 'writer'
  | 'notepad'
  | 'code'
  | 'web'
  | 'sheets'
  | 'slides'
  | 'pdf'
  | 'photos'
  | 'media'
  | 'whiteboard'
  | 'tasks';

export interface NewFileOption {
  /** Extension of the file "New" creates. */
  ext: string;
  label: string;
  /** Starting contents for a text file. */
  content?: string;
}

export interface AppMeta {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  tint: string;
  /** Route the tile opens. */
  path: string;
  kind: 'workspace' | 'route';
  keywords: string[];
  /** Hint shown on the "New with AI" button. */
  newPrompt: string;
  editor?: EditorKind;
  /** Which files the app lists. Absent on route apps. */
  accepts?: {
    /** Backend `file_type` values. */
    types: string[];
    /** When set, the file's extension must also be one of these. */
    exts?: string[];
  };
  /** What "New" makes. Empty means the app cannot create files. */
  newFiles?: NewFileOption[];
  /** Accepted by `<input type=file accept>` on the app's Upload button. */
  uploadAccept?: string;
}

const CODE_EXTS = [
  'py', 'js', 'jsx', 'ts', 'tsx', 'json', 'css', 'scss', 'sql', 'yaml', 'yml',
  'xml', 'sh', 'bash', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'cs', 'rb',
  'php', 'swift', 'toml', 'ini', 'env', 'dockerfile', 'r', 'lua', 'svg', 'ipynb',
];

const HTML_TEMPLATE = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>My page</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; }
    </style>
  </head>
  <body>
    <h1>Hello</h1>
    <p>Edit this page on the left and watch it update on the right.</p>
  </body>
</html>
`;

export const APPS: AppMeta[] = [
  {
    id: 'files',
    title: 'Files',
    description: 'Browse, organise and open everything in your workspace',
    icon: Folder,
    tint: 'from-amber-400 to-orange-500',
    path: '/documents',
    kind: 'route',
    keywords: ['finder', 'explorer', 'folder', 'documents', 'browse'],
    newPrompt: 'Organise my files',
  },
  {
    id: 'docs',
    title: 'Docs',
    description: 'Write Word documents and Markdown pages',
    icon: FileText,
    tint: 'from-blue-400 to-indigo-600',
    path: '/apps/docs',
    kind: 'workspace',
    editor: 'writer',
    keywords: ['document', 'write', 'markdown', 'word', 'docx', 'report', 'letter'],
    newPrompt: 'Draft a document about…',
    accepts: { types: ['docx', 'md'] },
    newFiles: [
      { ext: 'docx', label: 'Word document' },
      { ext: 'md', label: 'Markdown page', content: '# Untitled\n\nStart writing here.\n' },
    ],
    uploadAccept: '.docx,.md,.markdown',
  },
  {
    id: 'sheets',
    title: 'Sheets',
    description: 'Edit Excel workbooks and CSV tables cell by cell',
    icon: Table,
    tint: 'from-green-400 to-teal-600',
    path: '/apps/sheets',
    kind: 'workspace',
    editor: 'sheets',
    keywords: ['spreadsheet', 'excel', 'sheet', 'csv', 'xlsx', 'formula', 'grid', 'table'],
    newPrompt: 'Build a spreadsheet tracking…',
    accepts: { types: ['xlsx', 'csv'] },
    newFiles: [
      { ext: 'xlsx', label: 'Excel workbook' },
      { ext: 'csv', label: 'CSV table', content: 'Name,Value\n,\n' },
    ],
    uploadAccept: '.xlsx,.csv,.tsv',
  },
  {
    id: 'slides',
    title: 'Slides',
    description: 'Build decks and present them from the browser',
    icon: Presentation,
    tint: 'from-orange-400 to-red-500',
    path: '/apps/slides',
    kind: 'workspace',
    editor: 'slides',
    keywords: ['slides', 'deck', 'present', 'powerpoint', 'pptx', 'pitch'],
    newPrompt: 'Make a slide deck about…',
    accepts: { types: ['pptx'] },
    newFiles: [{ ext: 'pptx', label: 'Presentation' }],
    uploadAccept: '.pptx',
  },
  {
    id: 'notepad',
    title: 'Notepad',
    description: 'Plain text notes and logs, saved as you go',
    icon: NotebookPen,
    tint: 'from-slate-400 to-slate-600',
    path: '/apps/notepad',
    kind: 'workspace',
    editor: 'notepad',
    keywords: ['notes', 'text', 'txt', 'notepad', 'jot', 'log'],
    newPrompt: 'Take notes on…',
    accepts: { types: ['txt', 'md'], exts: ['txt', 'text', 'log', 'md', 'markdown'] },
    newFiles: [{ ext: 'txt', label: 'Text note' }],
    uploadAccept: '.txt,.log,.md',
  },
  {
    id: 'tasks',
    title: 'To Do',
    description: 'Checklists you tick off — stored as Markdown task lists',
    icon: CheckSquare,
    tint: 'from-violet-400 to-purple-600',
    path: '/apps/tasks',
    kind: 'workspace',
    editor: 'tasks',
    keywords: ['todo', 'tasks', 'checklist', 'list', 'plan'],
    newPrompt: 'Make a checklist for…',
    accepts: { types: ['md', 'txt'], exts: ['md', 'markdown', 'txt'] },
    newFiles: [{ ext: 'md', label: 'Checklist', content: '# To do\n\n- [ ] First task\n' }],
    uploadAccept: '.md,.txt',
  },
  {
    id: 'code',
    title: 'Code Editor',
    description: 'Edit scripts, JSON and config files with highlighting',
    icon: Code2,
    tint: 'from-zinc-500 to-zinc-800',
    path: '/apps/code',
    kind: 'workspace',
    editor: 'code',
    keywords: ['code', 'python', 'script', 'json', 'editor', 'ide', 'program'],
    newPrompt: 'Write a script that…',
    accepts: { types: ['txt', 'json'], exts: CODE_EXTS },
    newFiles: [
      { ext: 'py', label: 'Python script', content: 'def main():\n    print("Hello")\n\n\nif __name__ == "__main__":\n    main()\n' },
      { ext: 'js', label: 'JavaScript file', content: 'console.log("Hello");\n' },
      { ext: 'json', label: 'JSON file', content: '{\n  "name": "example"\n}\n' },
    ],
    uploadAccept: CODE_EXTS.map((e) => `.${e}`).join(','),
  },
  {
    id: 'web',
    title: 'Web Studio',
    description: 'Write an HTML page and see it render live',
    icon: Globe,
    tint: 'from-cyan-400 to-blue-600',
    path: '/apps/web',
    kind: 'workspace',
    editor: 'web',
    keywords: ['html', 'web', 'page', 'site', 'css', 'landing'],
    newPrompt: 'Build a landing page for…',
    accepts: { types: ['html'] },
    newFiles: [{ ext: 'html', label: 'Web page', content: HTML_TEMPLATE }],
    uploadAccept: '.html,.htm',
  },
  {
    id: 'pdf',
    title: 'PDF Reader',
    description: 'Read PDFs in the browser',
    icon: ScrollText,
    tint: 'from-red-400 to-rose-600',
    path: '/apps/pdf',
    kind: 'workspace',
    editor: 'pdf',
    keywords: ['pdf', 'read', 'reader', 'acrobat'],
    newPrompt: 'Turn this into a PDF…',
    accepts: { types: ['pdf'] },
    uploadAccept: '.pdf',
  },
  {
    id: 'photos',
    title: 'Photos',
    description: 'View images — zoom, rotate, flip through',
    icon: Image,
    tint: 'from-pink-400 to-rose-600',
    path: '/apps/photos',
    kind: 'workspace',
    editor: 'photos',
    keywords: ['image', 'photo', 'picture', 'gallery', 'png', 'jpg'],
    newPrompt: 'Generate an image of…',
    accepts: { types: ['image'] },
    uploadAccept: 'image/*',
  },
  {
    id: 'whiteboard',
    title: 'Whiteboard',
    description: 'Sketch, or draw on top of an image, and save it as a PNG',
    icon: PenTool,
    tint: 'from-yellow-400 to-amber-600',
    path: '/apps/whiteboard',
    kind: 'workspace',
    editor: 'whiteboard',
    keywords: ['draw', 'sketch', 'paint', 'annotate', 'whiteboard', 'diagram'],
    newPrompt: 'Draw a diagram of…',
    accepts: { types: ['image'] },
    uploadAccept: 'image/*',
  },
  {
    id: 'media',
    title: 'Media Player',
    description: 'Play video and audio files',
    icon: Film,
    tint: 'from-fuchsia-400 to-purple-600',
    path: '/apps/media',
    kind: 'workspace',
    editor: 'media',
    keywords: ['video', 'audio', 'music', 'play', 'player', 'mp4', 'mp3'],
    newPrompt: 'Generate a short video of…',
    accepts: { types: ['video', 'audio'] },
    uploadAccept: 'video/*,audio/*',
  },
  {
    id: 'dashboards',
    title: 'Dashboards',
    description: 'Live KPI, chart and table tiles',
    icon: LayoutDashboard,
    tint: 'from-emerald-400 to-green-600',
    path: '/dashboards',
    kind: 'route',
    keywords: ['data', 'chart', 'kpi', 'metrics', 'dashboard'],
    newPrompt: 'Track metrics on a dashboard…',
  },
  {
    id: 'pages',
    title: 'Pages',
    description: 'Reports and files published by link',
    icon: AppWindow,
    tint: 'from-sky-400 to-indigo-600',
    path: '/pages',
    kind: 'route',
    keywords: ['publish', 'share', 'page', 'report', 'link'],
    newPrompt: 'Publish this report as a page',
  },
  {
    id: 'imagine',
    title: 'Imagine',
    description: 'Generate images, video and audio with AI',
    icon: Sparkles,
    tint: 'from-indigo-400 to-violet-600',
    path: '/imagine',
    kind: 'route',
    keywords: ['generate', 'ai', 'image', 'art', 'create'],
    newPrompt: 'Generate an image of…',
  },
];

export function getApp(id: string | undefined): AppMeta | undefined {
  return APPS.find((a) => a.id === id);
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

type Openable = Pick<Document, 'filename' | 'file_type'>;

/** True when `app` lists and opens `doc`. */
export function acceptsDoc(app: AppMeta, doc: Openable): boolean {
  if (!app.accepts) return false;
  const type = (doc.file_type || '').toLowerCase();
  if (!app.accepts.types.includes(type)) return false;
  if (!app.accepts.exts) return true;
  return app.accepts.exts.includes(extensionOf(doc.filename));
}

/**
 * The apps that can open `doc`, best first.
 *
 * Order matters for the default: a `.md` opens in Docs (rendered), not in
 * Notepad or To Do, which are one "Open with…" away.
 */
const PREFERENCE = ['docs', 'sheets', 'slides', 'web', 'code', 'notepad', 'pdf', 'photos', 'media', 'tasks', 'whiteboard'];

export function appsForDoc(doc: Openable): AppMeta[] {
  return APPS.filter((a) => a.kind === 'workspace' && acceptsDoc(a, doc)).sort(
    (a, b) => PREFERENCE.indexOf(a.id) - PREFERENCE.indexOf(b.id),
  );
}

export function defaultAppFor(doc: Openable): AppMeta | undefined {
  return appsForDoc(doc)[0];
}

/** Where to go to open `doc` in `app` (default: its best app). */
export function openInAppPath(doc: Openable & { id: number }, app?: AppMeta): string | null {
  const target = app ?? defaultAppFor(doc);
  return target ? `${target.path}?file=${doc.id}` : null;
}

export function searchApps(query: string): AppMeta[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return APPS;
  return APPS.map((app) => {
    const title = app.title.toLowerCase();
    let score = 0;
    if (title === needle) score = 100;
    else if (title.startsWith(needle)) score = 80;
    else if (title.includes(needle)) score = 60;
    else if (app.keywords.some((k) => k.startsWith(needle))) score = 40;
    else if (app.keywords.some((k) => k.includes(needle))) score = 25;
    else if (app.description.toLowerCase().includes(needle)) score = 10;
    return { app, score };
  })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || a.app.title.localeCompare(b.app.title))
    .map((e) => e.app);
}
