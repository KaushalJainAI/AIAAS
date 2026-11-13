/**
 * The productivity apps: what each one is, which files it opens, and what "New"
 * makes. Pure data and decisions; no screens, no icon library.
 *
 * Mirrors: better-n8n-frontend/src/lib/apps.ts
 *
 * The web app's `accepts` rule is the whole contract: a file is listed by an app
 * when its `file_type` is in `accepts.types` and, if `accepts.exts` is set, its
 * extension is in that list too (a `.py` is stored as `txt`, so the extension
 * narrows further). `appsForDoc` answers "which app opens this file" from the
 * same table, so a file is never offered to an app that cannot open it.
 *
 * Differences from the web:
 * - `icon` is a lucide icon NAME (`'file-text'`), the name the web uses, as a
 *   string. The mobile screen maps it to an icon set.
 * - `tint` (a Tailwind gradient) is dropped; the screen chooses colours.
 * - `openInAppPath` is kept for parity: it returns the web route. A mobile
 *   screen should use `openTargetFor`, which returns the app id and file id.
 * - Route apps (Files, Dashboards, Pages, Imagine) are listed so the launcher is
 *   the one place to find them. Their `path` is the web route; the mobile app
 *   maps those routes to its own screens.
 */

export type EditorKind =
  | 'writer'
  | 'notepad'
  | 'code'
  | 'latex'
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
  /** Lucide icon name, as the web names it. */
  icon: string;
  /** Route the tile opens on the web. */
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
  /** What "New" makes. Empty or absent means the app cannot create files. */
  newFiles?: NewFileOption[];
  /** Accepted by the app's upload picker (the web's `<input accept>`). */
  uploadAccept?: string;
}

/** The part of a document the catalogue decides on. */
export interface OpenableFile {
  filename: string;
  file_type: string;
}

const CODE_EXTS = [
  'py', 'js', 'jsx', 'ts', 'tsx', 'json', 'css', 'scss', 'sql', 'yaml', 'yml',
  'xml', 'sh', 'bash', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'cs', 'rb',
  'php', 'swift', 'toml', 'ini', 'env', 'dockerfile', 'r', 'lua', 'svg', 'ipynb',
  'tex', 'latex', 'ltx', 'bib', 'sty', 'cls',
];

/** What the LaTeX app opens: sources it renders, and the files that travel with them. */
const LATEX_EXTS = ['tex', 'latex', 'ltx', 'bib', 'sty', 'cls'];

const LATEX_TEMPLATE = String.raw`\documentclass{article}
\usepackage{amsmath}

\title{Untitled}
\author{Your name}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
A short summary of what this document says.
\end{abstract}

\section{Introduction}
Start writing here. Inline math looks like $a^2 + b^2 = c^2$, and a numbered
equation looks like this:
\begin{equation}
  E = mc^2 \label{eq:energy}
\end{equation}
Equation~\ref{eq:energy} can be referred to by its label.

\section{Next steps}
\begin{itemize}
  \item Add sections with the toolbar.
  \item Use Insert for tables, figures and citations.
\end{itemize}

\end{document}
`;

const BIB_TEMPLATE = `@article{key,
  author  = {Author},
  title   = {Title},
  journal = {Journal},
  year    = {2026},
}
`;

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
    icon: 'folder',
    path: '/documents',
    kind: 'route',
    keywords: ['finder', 'explorer', 'folder', 'documents', 'browse'],
    newPrompt: 'Organise my files',
  },
  {
    id: 'docs',
    title: 'Docs',
    description: 'Write Word documents and Markdown pages',
    icon: 'file-text',
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
    icon: 'table',
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
    icon: 'presentation',
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
    icon: 'notebook-pen',
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
    icon: 'check-square',
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
    icon: 'code-2',
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
    id: 'latex',
    title: 'LaTeX',
    description: 'Write papers and notes in LaTeX and read the page beside the source',
    icon: 'sigma',
    path: '/apps/latex',
    kind: 'workspace',
    editor: 'latex',
    keywords: ['latex', 'tex', 'paper', 'math', 'equation', 'thesis', 'overleaf', 'bibtex', 'formula'],
    newPrompt: 'Write a LaTeX paper about…',
    accepts: { types: ['txt'], exts: LATEX_EXTS },
    newFiles: [
      { ext: 'tex', label: 'LaTeX document', content: LATEX_TEMPLATE },
      { ext: 'bib', label: 'Reference list', content: BIB_TEMPLATE },
    ],
    uploadAccept: LATEX_EXTS.map((e) => `.${e}`).join(','),
  },
  {
    id: 'web',
    title: 'Web Studio',
    description: 'Write an HTML page and see it render live',
    icon: 'globe',
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
    icon: 'scroll-text',
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
    icon: 'image',
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
    icon: 'pen-tool',
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
    icon: 'film',
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
    icon: 'layout-dashboard',
    path: '/dashboards',
    kind: 'route',
    keywords: ['data', 'chart', 'kpi', 'metrics', 'dashboard'],
    newPrompt: 'Track metrics on a dashboard…',
  },
  {
    id: 'pages',
    title: 'Pages',
    description: 'Reports and files published by link',
    icon: 'app-window',
    path: '/pages',
    kind: 'route',
    keywords: ['publish', 'share', 'page', 'report', 'link'],
    newPrompt: 'Publish this report as a page',
  },
  {
    id: 'imagine',
    title: 'Imagine',
    description: 'Generate images, video and audio with AI',
    icon: 'image',
    path: '/imagine',
    kind: 'route',
    keywords: ['generate', 'ai', 'image', 'art', 'create'],
    newPrompt: 'Generate an image of…',
  },
];

export function getApp(id: string | undefined): AppMeta | undefined {
  return APPS.find((a) => a.id === id);
}

/** The lowercase extension of a file name, or '' when it has none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** True when `app` lists and opens `doc`. */
export function acceptsDoc(app: AppMeta, doc: OpenableFile): boolean {
  if (!app.accepts) return false;
  const type = (doc.file_type || '').toLowerCase();
  if (!app.accepts.types.includes(type)) return false;
  if (!app.accepts.exts) return true;
  return app.accepts.exts.includes(extensionOf(doc.filename));
}

/**
 * Order of the apps that can open a file, best first. A `.md` opens in Docs
 * (rendered), not in Notepad or To Do, which are one "Open with" away.
 */
const PREFERENCE = ['docs', 'sheets', 'slides', 'web', 'latex', 'code', 'notepad', 'pdf', 'photos', 'media', 'tasks', 'whiteboard'];

/** The workspace apps that can open `doc`, best first. */
export function appsForDoc(doc: OpenableFile): AppMeta[] {
  return APPS.filter((a) => a.kind === 'workspace' && acceptsDoc(a, doc)).sort(
    (a, b) => PREFERENCE.indexOf(a.id) - PREFERENCE.indexOf(b.id),
  );
}

/** The app that opens `doc` by default, or undefined when none does. */
export function defaultAppFor(doc: OpenableFile): AppMeta | undefined {
  return appsForDoc(doc)[0];
}

/** Web route to open `doc` in `app` (default: its best app). Kept for parity with the web. */
export function openInAppPath(doc: OpenableFile & { id: number }, app?: AppMeta): string | null {
  const target = app ?? defaultAppFor(doc);
  return target ? `${target.path}?file=${doc.id}` : null;
}

/**
 * What the mobile app needs to open `doc`: which app, and which file. Null when
 * no workspace app opens the file.
 */
export function openTargetFor(
  doc: OpenableFile & { id: number },
  app?: AppMeta,
): { appId: string; documentId: number } | null {
  const target = app ?? defaultAppFor(doc);
  return target ? { appId: target.id, documentId: doc.id } : null;
}

/** Launcher search: title, then keywords, then description, best match first. */
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
