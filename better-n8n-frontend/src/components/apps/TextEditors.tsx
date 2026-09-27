/**
 * The text-shaped apps: Notepad, the Markdown side of Docs, Code Editor, Web
 * Studio and To Do. All of them are one text file opened through
 * `useTextFile`; they differ only in what sits beside the text.
 *
 * Web Studio's live preview is locked down like `FilePreview`'s HTML frame
 * (empty `sandbox`, no-network CSP) plus scripts off: the page is the user's
 * own, but it may be one an agent wrote from a web page it read.
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Bold, Code, Columns2, Eye, Heading1, Heading2, Italic, Link2, List, ListChecks, ListOrdered,
  PencilLine, Plus, Quote, Trash2, WrapText,
} from 'lucide-react';
import { useThemeContext } from '../../contexts/themeState';

// CodeMirror stays a lazy chunk: only the Code Editor downloads it.
const CodeMirrorView = lazy(() => import('./CodeMirrorView'));

import type { Document } from '../../api/documents';
import { useTextFile, type TextFile } from '../../hooks/useTextFile';
import { languageForFile } from '../../lib/codeLanguage';
import { parseTasks, serializeTasks, type TaskLine } from '../../lib/sheetGrid';
import { cn } from '../../lib/utils';
import MarkdownMessage from '../chat/MarkdownMessage';
import {
  Divider, EditorError, EditorLoading, SaveStatus, StaleBanner, ToolButton, Toolbar,
} from './EditorChrome';
import { isEditableTarget, isRedoKey, isSaveKey, isUndoKey } from '../../lib/editorKeys';

export interface EditorProps {
  doc: Document;
  onDirtyChange?: (dirty: boolean) => void;
}

function useReportDirty(file: TextFile, onDirtyChange?: (d: boolean) => void) {
  useEffect(() => {
    onDirtyChange?.(file.dirty);
  }, [file.dirty, onDirtyChange]);
}

function counts(text: string) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return `${text.split('\n').length.toLocaleString()} lines · ${words.toLocaleString()} words`;
}

/** A textarea that indents with Tab and saves with Ctrl+S. */
function TextSurface({
  file,
  className,
  wrap = true,
  mono,
  placeholder,
  areaRef,
}: {
  file: TextFile;
  className?: string;
  wrap?: boolean;
  mono?: boolean;
  placeholder?: string;
  areaRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isSaveKey(e)) {
      e.preventDefault();
      void file.save();
      return;
    }
    // Session undo/redo (Ctrl+Z / Ctrl+Y): the stack lives in the file hook,
    // so it works in every text-shaped app. preventDefault stops the
    // textarea's own stack from applying the same step twice.
    if (isUndoKey(e)) {
      e.preventDefault();
      file.undo();
      return;
    }
    if (isRedoKey(e)) {
      e.preventDefault();
      file.redo();
      return;
    }
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: end, value } = el;
      const next = `${value.slice(0, s)}  ${value.slice(end)}`;
      file.setText(next);
      requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
    }
  };
  return (
    <textarea
      ref={areaRef}
      value={file.text}
      onChange={(e) => file.setText(e.target.value)}
      onKeyDown={onKeyDown}
      spellCheck={!mono}
      placeholder={placeholder}
      wrap={wrap ? 'soft' : 'off'}
      aria-label="File contents"
      className={cn(
        'min-h-0 w-full flex-1 resize-none bg-background p-4 text-[13.5px] leading-relaxed text-foreground outline-none',
        mono && 'font-mono text-[13px]',
        !wrap && 'whitespace-pre',
        className,
      )}
    />
  );
}

function Frame({ file, children, extra, hint }: { file: TextFile; children: React.ReactNode; extra?: React.ReactNode; hint?: string }) {
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

// ---------------------------------------------------------------------------
// Notepad
// ---------------------------------------------------------------------------

export function NotepadEditor({ doc, onDirtyChange }: EditorProps) {
  const file = useTextFile(doc.id, { autosaveMs: 1500 });
  useReportDirty(file, onDirtyChange);
  const [wrap, setWrap] = useState(true);
  const [mono, setMono] = useState(false);
  return (
    <Frame file={file} hint="Saves automatically">
      <Toolbar>
        <ToolButton onClick={() => setWrap((w) => !w)} active={wrap} title="Word wrap">
          <WrapText className="h-4 w-4" /> <span className="hidden sm:inline">Wrap</span>
        </ToolButton>
        <ToolButton onClick={() => setMono((m) => !m)} active={mono} title="Monospace font">
          <Code className="h-4 w-4" /> <span className="hidden sm:inline">Monospace</span>
        </ToolButton>
      </Toolbar>
      <TextSurface file={file} wrap={wrap} mono={mono} placeholder="Start typing…" />
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Markdown (Docs)
// ---------------------------------------------------------------------------

type MdView = 'edit' | 'split' | 'preview';

/** Wrap the selection (or insert at the caret) — what the formatting buttons do. */
function applyMarkdown(
  area: HTMLTextAreaElement | null,
  file: TextFile,
  kind: 'bold' | 'italic' | 'code' | 'link' | 'h1' | 'h2' | 'ul' | 'ol' | 'task' | 'quote',
) {
  if (!area) return;
  const { selectionStart: s, selectionEnd: e, value } = area;
  const selected = value.slice(s, e);
  const wrapWith = (left: string, right: string, fallback: string) => {
    const body = selected || fallback;
    const next = value.slice(0, s) + left + body + right + value.slice(e);
    file.setText(next);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(s + left.length, s + left.length + body.length);
    });
  };
  const prefixLines = (prefix: (i: number) => string) => {
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const block = value.slice(lineStart, e) || '';
    const next = block
      .split('\n')
      .map((line, i) => prefix(i) + line.replace(/^(#{1,6} |[-*] \[[ xX]\] |[-*] |\d+\. |> )/, ''))
      .join('\n');
    file.setText(value.slice(0, lineStart) + next + value.slice(e));
    requestAnimationFrame(() => area.focus());
  };
  switch (kind) {
    case 'bold': return wrapWith('**', '**', 'bold text');
    case 'italic': return wrapWith('_', '_', 'italic text');
    case 'code': return wrapWith('`', '`', 'code');
    case 'link': return wrapWith('[', '](https://)', 'link text');
    case 'h1': return prefixLines(() => '# ');
    case 'h2': return prefixLines(() => '## ');
    case 'ul': return prefixLines(() => '- ');
    case 'ol': return prefixLines((i) => `${i + 1}. `);
    case 'task': return prefixLines(() => '- [ ] ');
    case 'quote': return prefixLines(() => '> ');
  }
}

export function MarkdownEditor({ doc, onDirtyChange }: EditorProps) {
  const file = useTextFile(doc.id, { autosaveMs: 1500 });
  useReportDirty(file, onDirtyChange);
  const area = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState<MdView>(() => (window.innerWidth >= 1024 ? 'split' : 'edit'));
  const fmt = (k: Parameters<typeof applyMarkdown>[2]) => applyMarkdown(area.current, file, k);

  return (
    <Frame file={file}>
      <Toolbar>
        {view !== 'preview' && (
          <>
            <ToolButton onClick={() => fmt('bold')} title="Bold"><Bold className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => fmt('italic')} title="Italic"><Italic className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => fmt('code')} title="Inline code"><Code className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => fmt('link')} title="Link"><Link2 className="h-4 w-4" /></ToolButton>
            <Divider />
            <ToolButton onClick={() => fmt('h1')} title="Heading"><Heading1 className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => fmt('h2')} title="Subheading"><Heading2 className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => fmt('ul')} title="Bulleted list"><List className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => fmt('ol')} title="Numbered list"><ListOrdered className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => fmt('task')} title="Checklist"><ListChecks className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => fmt('quote')} title="Quote"><Quote className="h-4 w-4" /></ToolButton>
          </>
        )}
        <div className="ml-auto flex rounded-md border border-border/60 p-0.5" role="group" aria-label="View">
          {([
            ['edit', PencilLine, 'Edit'],
            ['split', Columns2, 'Split'],
            ['preview', Eye, 'Preview'],
          ] as const).map(([v, Icon, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={cn(
                'inline-flex items-center gap-1 rounded px-2 py-1 text-[12px]',
                v === 'split' && 'hidden lg:inline-flex',
                view === v ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </Toolbar>
      <div className="flex min-h-0 flex-1">
        {view !== 'preview' && (
          <div className={cn('flex min-h-0 flex-col', view === 'split' ? 'w-1/2 border-r border-border/60' : 'w-full')}>
            <TextSurface file={file} areaRef={area} placeholder="Write in Markdown…" />
          </div>
        )}
        {view !== 'edit' && (
          <div className={cn('min-h-0 overflow-auto bg-card px-6 py-5', view === 'split' ? 'w-1/2' : 'mx-auto w-full max-w-3xl')}>
            {file.text.trim() ? (
              <MarkdownMessage content={file.text} variant="full" />
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
  const [wrap, setWrap] = useState(false);
  const { resolvedTheme } = useThemeContext();
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

  const format = () => {
    try {
      file.setText(`${JSON.stringify(JSON.parse(file.text), null, 2)}\n`);
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
        <ToolButton onClick={() => setWrap((w) => !w)} active={wrap} title="Wrap long lines">
          <WrapText className="h-4 w-4" />
        </ToolButton>
        {isJson && (
          <ToolButton onClick={format} disabled={!!jsonError} title="Format JSON">
            Format
          </ToolButton>
        )}
      </Toolbar>
      <Suspense fallback={<EditorLoading label="Loading the editor…" />}>
        <CodeMirrorView
          value={file.text}
          language={language}
          dark={resolvedTheme === 'dark'}
          wrap={wrap}
          onChange={file.setText}
          onSave={() => void file.save()}
        />
      </Suspense>
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

export function WebEditor({ doc, onDirtyChange }: EditorProps) {
  const file = useTextFile(doc.id, { autosaveMs: 1500 });
  useReportDirty(file, onDirtyChange);
  const [view, setView] = useState<MdView>(() => (window.innerWidth >= 1024 ? 'split' : 'edit'));
  // Debounced so the frame is not rebuilt on every keystroke.
  const [rendered, setRendered] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setRendered(file.text), 300);
    return () => window.clearTimeout(t);
  }, [file.text]);

  return (
    <Frame file={file} extra={<span>Scripts and network requests are off in the preview</span>}>
      <Toolbar>
        <div className="flex rounded-md border border-border/60 p-0.5" role="group" aria-label="View">
          {([
            ['edit', PencilLine, 'Code'],
            ['split', Columns2, 'Split'],
            ['preview', Eye, 'Preview'],
          ] as const).map(([v, Icon, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={cn(
                'inline-flex items-center gap-1 rounded px-2 py-1 text-[12px]',
                v === 'split' && 'hidden lg:inline-flex',
                view === v ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </Toolbar>
      <div className="flex min-h-0 flex-1">
        {view !== 'preview' && (
          <div className={cn('flex min-h-0 flex-col', view === 'split' ? 'w-1/2 border-r border-border/60' : 'w-full')}>
            <TextSurface file={file} mono wrap={false} />
          </div>
        )}
        {view !== 'edit' && (
          <div className={cn('min-h-0 bg-muted/30 p-3', view === 'split' ? 'w-1/2' : 'w-full')}>
            <iframe
              sandbox=""
              srcDoc={withCsp(rendered)}
              title={`Preview of ${doc.filename}`}
              className="h-full w-full rounded-md border border-border/60 bg-white"
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

export function TasksEditor({ doc, onDirtyChange }: EditorProps) {
  const file = useTextFile(doc.id, { autosaveMs: 1500 });
  useReportDirty(file, onDirtyChange);
  const lines = useMemo(() => parseTasks(file.text), [file.text]);
  const [draft, setDraft] = useState('');
  const [hideDone, setHideDone] = useState(false);

  const tasks = lines
    .map((line, index) => ({ line, index }))
    .filter((e): e is { line: Extract<TaskLine, { kind: 'task' }>; index: number } => e.line.kind === 'task');
  const done = tasks.filter((t) => t.line.done).length;
  const heading = lines.find((l) => l.kind === 'other' && /^#\s/.test(l.raw));

  const update = (next: TaskLine[]) => file.setText(serializeTasks(next));
  const patch = (index: number, change: Partial<Extract<TaskLine, { kind: 'task' }>>) =>
    update(lines.map((l, i) => (i === index && l.kind === 'task' ? { ...l, ...change } : l)));
  const remove = (index: number) => update(lines.filter((_, i) => i !== index));
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    update([...lines, { kind: 'task', done: false, text, indent: '' }]);
    setDraft('');
  };

  return (
    <Frame file={file} hint="Saves automatically" extra={<span>{done} of {tasks.length} done</span>}>
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
          ) : (
            <>
              <ul className="m-0 list-none space-y-1 p-0">
                {tasks
                  .filter((t) => !(hideDone && t.line.done))
                  .map(({ line, index }) => (
                    <li
                      key={index}
                      className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
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
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        aria-label={`Delete ${line.text}`}
                        className="rounded p-1 text-muted-foreground opacity-60 hover:bg-destructive/10 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
              </ul>
              <div className="mt-4 flex gap-3 text-[12px]">
                <button type="button" onClick={() => setHideDone((h) => !h)} className="text-primary hover:underline">
                  {hideDone ? 'Show completed' : 'Hide completed'}
                </button>
                {done > 0 && (
                  <button
                    type="button"
                    onClick={() => update(lines.filter((l) => !(l.kind === 'task' && l.done)))}
                    className="text-muted-foreground hover:text-destructive hover:underline"
                  >
                    Clear completed
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Frame>
  );
}
