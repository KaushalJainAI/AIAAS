/**
 * The text-shaped apps: Notepad, the Markdown side of Docs, Code Editor, Web
 * Studio and To Do. All of them are one text file opened through
 * `useTextFile`; they differ only in what sits beside the text.
 *
 * The four that show source share one editor (`CodeMirrorView`), so undo,
 * find and replace, go-to-line and the font size behave the same in each —
 * every toolbar button calls the command its keyboard shortcut runs.
 *
 * Web Studio's live preview is locked down like `FilePreview`'s HTML frame
 * (empty `sandbox`, no-network CSP) plus scripts off: the page is the user's
 * own, but it may be one an agent wrote from a web page it read.
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  AArrowDown, AArrowUp, ArrowDown, ArrowUp, Bold, CalendarClock, CaseSensitive, CheckCheck, Code,
  Columns2, Copy, CopyPlus, Eye, Hash, Heading1, Heading2, Heading3, Image, IndentDecrease,
  IndentIncrease, Italic, Link2, List, ListChecks, ListOrdered, Minus, Monitor, MoreHorizontal,
  PencilLine, Plus, Quote, Redo2, RefreshCw, Search, Smartphone, SquareCode, Strikethrough, Table,
  Tablet, TextCursorInput, Trash2, Undo2, WrapText,
} from 'lucide-react';

import type { Document } from '../../api/documents';
import { useThemeContext } from '../../contexts/themeState';
import { useTextFile, type TextFile } from '../../hooks/useTextFile';
import { languageForFile } from '../../lib/codeLanguage';
import { isEditableTarget, isRedoKey, isUndoKey } from '../../lib/editorKeys';
import { parseTasks, serializeTasks, type TaskLine } from '../../lib/sheetGrid';
import {
  dedupeLines, markdownTable, readingTime, sortLines, textStats, timestamp, titleCase,
  trimTrailingSpaces,
} from '../../lib/textTools';
import { toast } from '../../lib/toastStore';
import { cn } from '../../lib/utils';
import MarkdownMessage from '../chat/MarkdownMessage';
import type { CodeMirrorApi } from './CodeMirrorView';
import { copyText, useFontSize } from './editorTools';
import {
  Divider, EditorError, EditorLoading, SaveStatus, StaleBanner, ToolButton, ToolMenu, Toolbar,
  ViewSwitch, type SplitView,
} from './EditorChrome';

// CodeMirror stays a lazy chunk: only the text apps download it.
const CodeMirrorView = lazy(() => import('./CodeMirrorView'));

export interface EditorProps {
  doc: Document;
  onDirtyChange?: (dirty: boolean) => void;
}

export type EditorApi = RefObject<CodeMirrorApi | null>;

function useReportDirty(file: TextFile, onDirtyChange?: (d: boolean) => void) {
  useEffect(() => {
    onDirtyChange?.(file.dirty);
  }, [file.dirty, onDirtyChange]);
}

function counts(text: string) {
  const { lines, words, chars } = textStats(text);
  return `${lines.toLocaleString()} lines · ${words.toLocaleString()} words · ${chars.toLocaleString()} characters`;
}

export function Frame({ file, children, extra, hint }: { file: TextFile; children: React.ReactNode; extra?: React.ReactNode; hint?: string }) {
  if (file.loading) return <EditorLoading />;
  if (file.error) return <EditorError message={file.error} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {file.stale && <StaleBanner onReload={file.reload} onOverwrite={() => void file.overwrite()} />}
      {children}
      <SaveStatus
        dirty={file.dirty}
        saving={file.saving}
        hint={hint ?? 'Autosaves as you type'}
        extra={extra ?? counts(file.text)}
      />
    </div>
  );
}

/** Undo, redo and find — the same three in every source editor. */
export function EditButtons({ api }: { api: EditorApi }) {
  return (
    <>
      <ToolButton onClick={() => api.current?.undo()} title="Undo (Ctrl+Z)"><Undo2 className="h-4 w-4" /></ToolButton>
      <ToolButton onClick={() => api.current?.redo()} title="Redo (Ctrl+Y)"><Redo2 className="h-4 w-4" /></ToolButton>
      <ToolButton onClick={() => api.current?.find()} title="Find and replace (Ctrl+F)"><Search className="h-4 w-4" /></ToolButton>
    </>
  );
}

export function FontButtons({ size, step }: { size: number; step: (direction: 1 | -1) => void }) {
  return (
    <>
      <ToolButton onClick={() => step(-1)} disabled={size <= 10} title="Smaller text"><AArrowDown className="h-4 w-4" /></ToolButton>
      <ToolButton onClick={() => step(1)} disabled={size >= 24} title="Larger text"><AArrowUp className="h-4 w-4" /></ToolButton>
    </>
  );
}

/** The shared source editor, wired to one open file. */
export function Source({
  file, api, language, wrap, fontSize, plain, sans, placeholder,
}: {
  file: TextFile;
  api: EditorApi;
  language: string | null;
  wrap: boolean;
  fontSize: number;
  plain?: boolean;
  sans?: boolean;
  placeholder?: string;
}) {
  const { resolvedTheme } = useThemeContext();
  return (
    <Suspense fallback={<EditorLoading label="Loading the editor…" />}>
      <CodeMirrorView
        value={file.text}
        language={language}
        dark={resolvedTheme === 'dark'}
        wrap={wrap}
        fontSize={fontSize}
        plain={plain}
        sans={sans}
        placeholder={placeholder}
        apiRef={api}
        onChange={file.setText}
        onSave={() => void file.save()}
      />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Notepad
// ---------------------------------------------------------------------------

export function NotepadEditor({ doc, onDirtyChange }: EditorProps) {
  const file = useTextFile(doc.id, { autosaveMs: 1500 });
  useReportDirty(file, onDirtyChange);
  const api = useRef<CodeMirrorApi | null>(null);
  const [wrap, setWrap] = useState(true);
  const [mono, setMono] = useState(false);
  const [size, stepSize] = useFontSize('notepad', 14);
  const change = (fn: (text: string) => string) => api.current?.transform(fn);

  return (
    <Frame file={file} hint="Saves automatically">
      <Toolbar>
        <EditButtons api={api} />
        <Divider />
        <ToolButton onClick={() => setWrap((w) => !w)} active={wrap} title="Word wrap">
          <WrapText className="h-4 w-4" /> <span className="hidden sm:inline">Wrap</span>
        </ToolButton>
        <ToolButton onClick={() => setMono((m) => !m)} active={mono} title="Monospace font">
          <Code className="h-4 w-4" /> <span className="hidden sm:inline">Monospace</span>
        </ToolButton>
        <FontButtons size={size} step={stepSize} />
        <Divider />
        <ToolButton onClick={() => api.current?.insertText(timestamp())} title="Insert date and time">
          <CalendarClock className="h-4 w-4" /> <span className="hidden md:inline">Date</span>
        </ToolButton>
        <ToolMenu
          title="Change the text"
          items={[
            { label: 'UPPERCASE', onClick: () => change((t) => t.toUpperCase()) },
            { label: 'lowercase', onClick: () => change((t) => t.toLowerCase()) },
            { label: 'Title Case', onClick: () => change(titleCase) },
            { label: 'Sort lines A → Z', onClick: () => change(sortLines), divider: true },
            { label: 'Remove duplicate lines', onClick: () => change(dedupeLines) },
            { label: 'Trim trailing spaces', onClick: () => change(trimTrailingSpaces) },
          ]}
        >
          <CaseSensitive className="h-4 w-4" /> <span className="hidden md:inline">Text</span>
        </ToolMenu>
        <ToolMenu
          title="More"
          align="right"
          items={[
            { label: 'Go to line…', onClick: () => api.current?.gotoLine(), icon: <Hash />, hint: 'Ctrl+Alt+G' },
            { label: 'Select all', onClick: () => api.current?.selectAll(), icon: <TextCursorInput />, hint: 'Ctrl+A' },
            { label: 'Copy everything', onClick: () => void copyText(file.text, 'Note'), icon: <Copy /> },
          ]}
        >
          <MoreHorizontal className="h-4 w-4" />
        </ToolMenu>
      </Toolbar>
      <Source
        file={file}
        api={api}
        language={null}
        wrap={wrap}
        fontSize={size}
        plain
        sans={!mono}
        placeholder="Start typing…"
      />
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Markdown (Docs)
// ---------------------------------------------------------------------------

const LIST_PREFIX = /^(#{1,6} |[-*] \[[ xX]\] |[-*] |\d+\. |> )/;

const SOURCE_VIEWS = [
  ['edit', PencilLine, 'Edit'],
  ['split', Columns2, 'Split'],
  ['preview', Eye, 'Preview'],
] as const;

export function MarkdownEditor({ doc, onDirtyChange }: EditorProps) {
  const file = useTextFile(doc.id, { autosaveMs: 1500 });
  useReportDirty(file, onDirtyChange);
  const api = useRef<CodeMirrorApi | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<SplitView>(() => (window.innerWidth >= 1024 ? 'split' : 'edit'));
  const [size, stepSize] = useFontSize('markdown', 14);
  const wrapWith = (before: string, after: string, fallback: string) => api.current?.wrapSelection(before, after, fallback);
  const prefix = (make: (i: number) => string) => api.current?.prefixLines(make, LIST_PREFIX);
  const stats = textStats(file.text);

  /** The rendered page, as formatted text a mail or a document will keep. */
  const copyFormatted = async () => {
    const node = preview.current;
    if (!node) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([node.innerHTML], { type: 'text/html' }),
          'text/plain': new Blob([node.innerText], { type: 'text/plain' }),
        }),
      ]);
      toast.success('Formatted text copied');
    } catch {
      toast.error('Could not copy', 'Your browser blocked the clipboard.');
    }
  };

  return (
    <Frame
      file={file}
      extra={`${stats.words.toLocaleString()} words · ${readingTime(stats.words)} · ${stats.lines.toLocaleString()} lines`}
    >
      <Toolbar>
        {view !== 'preview' && (
          <>
            <EditButtons api={api} />
            <Divider />
            <ToolButton onClick={() => wrapWith('**', '**', 'bold text')} title="Bold"><Bold className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => wrapWith('_', '_', 'italic text')} title="Italic"><Italic className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => wrapWith('~~', '~~', 'struck text')} title="Strikethrough"><Strikethrough className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => wrapWith('`', '`', 'code')} title="Inline code"><Code className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => wrapWith('[', '](https://)', 'link text')} title="Link"><Link2 className="h-4 w-4" /></ToolButton>
            <Divider />
            <ToolButton onClick={() => prefix(() => '# ')} title="Heading"><Heading1 className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => prefix(() => '## ')} title="Subheading"><Heading2 className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => prefix(() => '### ')} title="Small heading"><Heading3 className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => prefix(() => '- ')} title="Bulleted list"><List className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => prefix((i) => `${i + 1}. `)} title="Numbered list"><ListOrdered className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => prefix(() => '- [ ] ')} title="Checklist"><ListChecks className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => prefix(() => '> ')} title="Quote"><Quote className="h-4 w-4" /></ToolButton>
            <Divider />
            <ToolMenu
              title="Insert"
              items={[
                { label: 'Table', onClick: () => api.current?.insertBlock(markdownTable(3, 2)), icon: <Table /> },
                { label: 'Code block', onClick: () => wrapWith('```\n', '\n```', 'code'), icon: <SquareCode /> },
                { label: 'Image', onClick: () => wrapWith('![', '](https://)', 'description'), icon: <Image /> },
                { label: 'Divider line', onClick: () => api.current?.insertBlock('\n---\n'), icon: <Minus /> },
                { label: 'Date and time', onClick: () => api.current?.insertText(timestamp()), icon: <CalendarClock /> },
              ]}
            >
              <Plus className="h-4 w-4" /> <span className="hidden md:inline">Insert</span>
            </ToolMenu>
            <FontButtons size={size} step={stepSize} />
          </>
        )}
        <ToolMenu
          title="More"
          items={[
            { label: 'Copy Markdown', onClick: () => void copyText(file.text, 'Markdown'), icon: <Copy /> },
            {
              label: 'Copy formatted text',
              onClick: () => void copyFormatted(),
              icon: <CopyPlus />,
              disabled: view === 'edit',
              hint: view === 'edit' ? 'needs Preview' : undefined,
            },
            { label: 'Go to line…', onClick: () => api.current?.gotoLine(), icon: <Hash />, disabled: view === 'preview' },
          ]}
        >
          <MoreHorizontal className="h-4 w-4" />
        </ToolMenu>
        <ViewSwitch view={view} onChange={setView} options={SOURCE_VIEWS} />
      </Toolbar>
      <div className="flex min-h-0 flex-1">
        {view !== 'preview' && (
          <div className={cn('app-no-print flex min-h-0 flex-col', view === 'split' ? 'w-1/2 border-r border-border/60' : 'w-full')}>
            <Source file={file} api={api} language="markdown" wrap fontSize={size} placeholder="Write in Markdown…" />
          </div>
        )}
        {view !== 'edit' && (
          <div className={cn('min-h-0 overflow-auto bg-card px-6 py-5', view === 'split' ? 'w-1/2' : 'mx-auto w-full max-w-3xl')}>
            {file.text.trim() ? (
              <div ref={preview}><MarkdownMessage content={file.text} variant="full" /></div>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
            )}
          </div>
        )}
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Code Editor
// ---------------------------------------------------------------------------

export function CodeEditor({ doc, onDirtyChange }: EditorProps) {
  const file = useTextFile(doc.id, { autosaveMs: 1500 });
  useReportDirty(file, onDirtyChange);
  const api = useRef<CodeMirrorApi | null>(null);
  const [wrap, setWrap] = useState(false);
  const [size, stepSize] = useFontSize('code', 13);
  const language = languageForFile(doc.filename);
  const lineCount = file.text.split('\n').length;

  const isJson = /\.json$/i.test(doc.filename);
  const jsonError = useMemo(() => {
    if (!isJson || !file.text.trim()) return null;
    try {
      JSON.parse(file.text);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Invalid JSON';
    }
  }, [isJson, file.text]);

  const reshape = (indent: number | undefined) => {
    try {
      const parsed: unknown = JSON.parse(file.text);
      file.setText(indent === undefined ? JSON.stringify(parsed) : `${JSON.stringify(parsed, null, indent)}\n`);
    } catch {
      // The status bar already says why.
    }
  };

  return (
    <Frame
      file={file}
      extra={
        <>
          {jsonError && <span className="truncate text-destructive">JSON: {jsonError}</span>}
          <span>{language ?? 'plain text'}</span>
          <span>{lineCount.toLocaleString()} lines</span>
        </>
      }
    >
      <Toolbar>
        <EditButtons api={api} />
        <ToolButton onClick={() => api.current?.gotoLine()} title="Go to line (Ctrl+Alt+G)"><Hash className="h-4 w-4" /></ToolButton>
        <Divider />
        <ToolButton onClick={() => setWrap((w) => !w)} active={wrap} title="Wrap long lines">
          <WrapText className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => api.current?.toggleComment()} title="Comment or uncomment (Ctrl+/)">
          <span className="font-mono text-[12px]">//</span>
        </ToolButton>
        <FontButtons size={size} step={stepSize} />
        {isJson && (
          <>
            <Divider />
            <ToolButton onClick={() => reshape(2)} disabled={!!jsonError} title="Format JSON">Format</ToolButton>
            <ToolButton onClick={() => reshape(undefined)} disabled={!!jsonError} title="Minify JSON to one line">Minify</ToolButton>
          </>
        )}
        <ToolMenu
          title="More"
          align="right"
          items={[
            { label: 'Copy everything', onClick: () => void copyText(file.text, 'Code'), icon: <Copy /> },
            { label: 'Select all', onClick: () => api.current?.selectAll(), icon: <TextCursorInput />, hint: 'Ctrl+A' },
            { label: 'Trim trailing spaces', onClick: () => file.setText(trimTrailingSpaces(file.text)), icon: <Minus /> },
          ]}
        >
          <MoreHorizontal className="h-4 w-4" />
        </ToolMenu>
      </Toolbar>
      <Source file={file} api={api} language={language} wrap={wrap} fontSize={size} />
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Web Studio
// ---------------------------------------------------------------------------

const WEB_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:";

function withCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${WEB_CSP}" />`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${meta}`) : `${meta}${html}`;
}

const WEB_VIEWS = [
  ['edit', PencilLine, 'Code'],
  ['split', Columns2, 'Split'],
  ['preview', Eye, 'Preview'],
] as const;

const SCREENS = [
  ['phone', Smartphone, 'Phone width', 390],
  ['tablet', Tablet, 'Tablet width', 768],
  ['desktop', Monitor, 'Full width', null],
] as const;

export function WebEditor({ doc, onDirtyChange }: EditorProps) {
  const file = useTextFile(doc.id, { autosaveMs: 1500 });
  useReportDirty(file, onDirtyChange);
  const api = useRef<CodeMirrorApi | null>(null);
  const [view, setView] = useState<SplitView>(() => (window.innerWidth >= 1024 ? 'split' : 'edit'));
  const [wrap, setWrap] = useState(false);
  const [screen, setScreen] = useState<(typeof SCREENS)[number][0]>('desktop');
  const [size, stepSize] = useFontSize('web', 13);
  const [frameKey, setFrameKey] = useState(0);
  // Debounced so the frame is not rebuilt on every keystroke.
  const [rendered, setRendered] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setRendered(file.text), 300);
    return () => window.clearTimeout(t);
  }, [file.text]);
  const width = SCREENS.find((s) => s[0] === screen)?.[3] ?? null;
  const block = (html: string) => api.current?.insertBlock(html);

  return (
    <Frame file={file} extra={<span>Scripts and network requests are off in the preview</span>}>
      <Toolbar>
        {view !== 'preview' && (
          <>
            <EditButtons api={api} />
            <Divider />
            <ToolButton onClick={() => setWrap((w) => !w)} active={wrap} title="Wrap long lines"><WrapText className="h-4 w-4" /></ToolButton>
            <FontButtons size={size} step={stepSize} />
            <ToolMenu
              title="Insert"
              items={[
                { label: 'Heading', onClick: () => block('<h2>Heading</h2>'), icon: <Heading2 /> },
                { label: 'Paragraph', onClick: () => block('<p>Text</p>'), icon: <PencilLine /> },
                { label: 'Link', onClick: () => api.current?.wrapSelection('<a href="https://">', '</a>', 'link text'), icon: <Link2 /> },
                { label: 'Image', onClick: () => block('<img src="data:" alt="Description" />'), icon: <Image /> },
                { label: 'List', onClick: () => block('<ul>\n  <li>First</li>\n  <li>Second</li>\n</ul>'), icon: <List /> },
                { label: 'Table', onClick: () => block('<table>\n  <tr><th>Name</th><th>Value</th></tr>\n  <tr><td></td><td></td></tr>\n</table>'), icon: <Table /> },
                { label: 'Button', onClick: () => block('<button type="button">Click</button>'), icon: <SquareCode /> },
                { label: 'Style block', onClick: () => block('<style>\n  body { font-family: system-ui, sans-serif; }\n</style>'), icon: <Code />, divider: true },
              ]}
            >
              <Plus className="h-4 w-4" /> <span className="hidden md:inline">Insert</span>
            </ToolMenu>
          </>
        )}
        {view !== 'edit' && (
          <>
            {view !== 'preview' && <Divider />}
            {SCREENS.map(([value, Icon, label]) => (
              <ToolButton key={value} onClick={() => setScreen(value)} active={screen === value} title={label}>
                <Icon className="h-4 w-4" />
              </ToolButton>
            ))}
            <ToolButton onClick={() => setFrameKey((k) => k + 1)} title="Reload the preview"><RefreshCw className="h-4 w-4" /></ToolButton>
          </>
        )}
        <ToolMenu
          title="More"
          items={[
            { label: 'Copy the HTML', onClick: () => void copyText(file.text, 'HTML'), icon: <Copy /> },
            { label: 'Go to line…', onClick: () => api.current?.gotoLine(), icon: <Hash />, disabled: view === 'preview' },
          ]}
        >
          <MoreHorizontal className="h-4 w-4" />
        </ToolMenu>
        <ViewSwitch view={view} onChange={setView} options={WEB_VIEWS} />
      </Toolbar>
      <div className="flex min-h-0 flex-1">
        {view !== 'preview' && (
          <div className={cn('app-no-print flex min-h-0 flex-col', view === 'split' ? 'w-1/2 border-r border-border/60' : 'w-full')}>
            <Source file={file} api={api} language="html" wrap={wrap} fontSize={size} />
          </div>
        )}
        {view !== 'edit' && (
          <div className={cn('flex min-h-0 justify-center overflow-auto bg-muted/30 p-3', view === 'split' ? 'w-1/2' : 'w-full')}>
            <iframe
              key={frameKey}
              sandbox=""
              srcDoc={withCsp(rendered)}
              title={`Preview of ${doc.filename}`}
              style={width ? { width, maxWidth: '100%' } : undefined}
              className={cn('h-full rounded-md border border-border/60 bg-white', width ? 'shrink-0 shadow-md' : 'w-full')}
            />
          </div>
        )}
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// To Do
// ---------------------------------------------------------------------------

type TaskFilter = 'all' | 'open' | 'done';
type Task = Extract<TaskLine, { kind: 'task' }>;

export function TasksEditor({ doc, onDirtyChange }: EditorProps) {
  const file = useTextFile(doc.id, { autosaveMs: 1500 });
  useReportDirty(file, onDirtyChange);
  const lines = useMemo(() => parseTasks(file.text), [file.text]);
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [query, setQuery] = useState('');

  const tasks = lines
    .map((line, index) => ({ line, index }))
    .filter((e): e is { line: Task; index: number } => e.line.kind === 'task');
  const done = tasks.filter((t) => t.line.done).length;
  const heading = lines.find((l) => l.kind === 'other' && /^#\s/.test(l.raw));
  const needle = query.trim().toLowerCase();
  const shown = tasks.filter(
    (t) =>
      (filter === 'all' || (filter === 'done') === t.line.done)
      && (!needle || t.line.text.toLowerCase().includes(needle)),
  );

  const update = (next: TaskLine[]) => file.setText(serializeTasks(next));
  const patch = (index: number, change: Partial<Task>) =>
    update(lines.map((l, i) => (i === index && l.kind === 'task' ? { ...l, ...change } : l)));
  const remove = (index: number) => update(lines.filter((_, i) => i !== index));
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    update([...lines, { kind: 'task', done: false, text, indent: '' }]);
    setDraft('');
  };
  /** Swap a task with the task before or after it, leaving other lines where they are. */
  const move = (index: number, direction: 1 | -1) => {
    const at = tasks.findIndex((t) => t.index === index);
    const other = tasks[at + direction];
    if (!other) return;
    const next = [...lines];
    [next[index], next[other.index]] = [next[other.index], next[index]];
    update(next);
  };
  const indent = (index: number, direction: 1 | -1) => {
    const line = lines[index];
    if (line.kind !== 'task') return;
    patch(index, { indent: direction === 1 ? `${line.indent}  ` : line.indent.slice(2) });
  };
  const duplicate = (index: number) => {
    const next = [...lines];
    next.splice(index + 1, 0, { ...(lines[index] as Task), done: false });
    update(next);
  };
  const setAll = (value: boolean) => update(lines.map((l) => (l.kind === 'task' ? { ...l, done: value } : l)));
  /** Open tasks first, each group keeping its own order; other lines stay put. */
  const openFirst = () => {
    const ordered = [...tasks.filter((t) => !t.line.done), ...tasks.filter((t) => t.line.done)];
    const next = [...lines];
    tasks.forEach((slot, i) => {
      next[slot.index] = ordered[i].line;
    });
    update(next);
  };

  return (
    <Frame file={file} hint="Saves automatically" extra={<span>{done} of {tasks.length} done</span>}>
      <Toolbar>
        <ToolButton onClick={file.undo} disabled={!file.canUndo} title="Undo (Ctrl+Z)"><Undo2 className="h-4 w-4" /></ToolButton>
        <ToolButton onClick={file.redo} disabled={!file.canRedo} title="Redo (Ctrl+Y)"><Redo2 className="h-4 w-4" /></ToolButton>
        <Divider />
        <div className="flex shrink-0 rounded-md border border-border/60 p-0.5" role="group" aria-label="Show">
          {(['all', 'open', 'done'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={cn(
                'rounded px-2 py-1 text-[12px] capitalize',
                filter === value ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {value}
            </button>
          ))}
        </div>
        <label className="flex h-8 min-w-32 max-w-56 flex-1 items-center gap-1.5 rounded-md border border-border/60 bg-background px-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a task"
            aria-label="Find a task"
            className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
          />
        </label>
        <ToolMenu
          title="More"
          align="right"
          items={[
            { label: 'Mark all done', onClick: () => setAll(true), icon: <CheckCheck />, disabled: done === tasks.length },
            { label: 'Mark all not done', onClick: () => setAll(false), icon: <ListChecks />, disabled: done === 0 },
            { label: 'Move open tasks to the top', onClick: openFirst, icon: <ArrowUp />, disabled: tasks.length < 2 },
            { label: 'Copy the list', onClick: () => void copyText(file.text, 'List'), icon: <Copy />, divider: true },
            {
              label: 'Clear completed',
              onClick: () => update(lines.filter((l) => !(l.kind === 'task' && l.done))),
              icon: <Trash2 />,
              disabled: done === 0,
              danger: true,
            },
          ]}
        >
          <MoreHorizontal className="h-4 w-4" />
        </ToolMenu>
      </Toolbar>
      <div
        className="min-h-0 flex-1 overflow-auto"
        onKeyDown={(e) => {
          // Checkbox toggles and text fields keep their native keys; anywhere
          // else steps the file's session history.
          if (isEditableTarget(e.target)) return;
          if (isUndoKey(e)) {
            e.preventDefault();
            file.undo();
          } else if (isRedoKey(e)) {
            e.preventDefault();
            file.redo();
          }
        }}
      >
        <div className="mx-auto max-w-2xl px-4 py-6">
          <h2 className="mb-1 text-lg font-semibold">
            {heading && heading.kind === 'other' ? heading.raw.replace(/^#\s*/, '') : doc.filename.replace(/\.[^.]+$/, '')}
          </h2>
          {tasks.length > 0 && (
            <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${(done / tasks.length) * 100}%` }} />
            </div>
          )}
          <form
            className="mb-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a task and press Enter"
              aria-label="New task"
              className="min-w-0 flex-1 rounded-md border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button type="submit" className="inline-flex items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
              <Plus className="h-4 w-4" /> Add
            </button>
          </form>
          {tasks.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No tasks in this file yet. Lines written as <code>- [ ] task</code> show up here.
            </p>
          ) : shown.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {needle ? `No task matches “${query}”.` : filter === 'done' ? 'Nothing is done yet.' : 'Everything is done.'}
            </p>
          ) : (
            <ul className="m-0 list-none space-y-1 p-0">
              {shown.map(({ line, index }) => (
                <li
                  key={index}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                  style={{ paddingLeft: `${0.5 + line.indent.length * 0.6}rem` }}
                >
                  <input
                    type="checkbox"
                    checked={line.done}
                    onChange={(e) => patch(index, { done: e.target.checked })}
                    aria-label={`Done: ${line.text}`}
                    className="h-4 w-4 shrink-0 accent-primary"
                  />
                  <input
                    value={line.text}
                    onChange={(e) => patch(index, { text: e.target.value })}
                    aria-label="Task"
                    className={cn(
                      'min-w-0 flex-1 bg-transparent text-sm outline-none',
                      line.done && 'text-muted-foreground line-through',
                    )}
                  />
                  <ToolMenu
                    title={`Actions for ${line.text}`}
                    align="right"
                    items={[
                      { label: 'Move up', onClick: () => move(index, -1), icon: <ArrowUp /> },
                      { label: 'Move down', onClick: () => move(index, 1), icon: <ArrowDown /> },
                      { label: 'Make a sub-task', onClick: () => indent(index, 1), icon: <IndentIncrease /> },
                      { label: 'Move out a level', onClick: () => indent(index, -1), icon: <IndentDecrease />, disabled: !line.indent },
                      { label: 'Duplicate', onClick: () => duplicate(index), icon: <CopyPlus /> },
                      { label: 'Delete', onClick: () => remove(index), icon: <Trash2 />, danger: true, divider: true },
                    ]}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </ToolMenu>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Frame>
  );
}
