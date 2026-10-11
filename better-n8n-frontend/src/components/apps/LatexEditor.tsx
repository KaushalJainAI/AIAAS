/**
 * The LaTeX app: `.tex` source on the left, the page it describes on the right.
 *
 * The right side is `LatexPreview` — a reading view built in the browser
 * (structure by `lib/latex.ts`, math by KaTeX), not a TeX build. That is said
 * in the status bar, with a count of what the preview could not draw, because
 * a paper that silently differs from its PDF is worse than no preview.
 *
 * Source editing is the shared `CodeMirrorView`, so find and replace, undo
 * and the outline's jump-to-line are the same commands as in the Code Editor.
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold, BookOpen, Code, Columns2, Copy, Eye, FileCode2, Footprints, Hash, Heading1, Heading2,
  Image, Italic, Link2, List, ListOrdered, ListTree, MoreHorizontal, Pi, Plus, Quote, Sigma,
  SquareCode, Table, WrapText,
} from 'lucide-react';

import { useTextFile } from '../../hooks/useTextFile';
import { isLatexFile, parseLatex, sourceOutline } from '../../lib/latex';
import { latexTable, textStats } from '../../lib/textTools';
import { cn } from '../../lib/utils';
import type { CodeMirrorApi } from './CodeMirrorView';
import {
  Divider, EditorLoading, ToolButton, ToolMenu, Toolbar, ViewSwitch, type SplitView,
} from './EditorChrome';
import { copyText, useFontSize } from './editorTools';
import { EditButtons, FontButtons, Frame, Source, type EditorProps } from './TextEditors';

// KaTeX and its fonts load only when a LaTeX file is on screen.
const LatexPreview = lazy(() => import('../files/LatexPreview'));

const VIEWS = [
  ['edit', FileCode2, 'Source'],
  ['split', Columns2, 'Split'],
  ['preview', Eye, 'Page'],
] as const;

const FIGURE = [
  '\\begin{figure}[h]',
  '  \\centering',
  '  \\includegraphics[width=0.8\\linewidth]{image.png}',
  '  \\caption{Caption}',
  '  \\label{fig:label}',
  '\\end{figure}',
].join('\n');

const BIBLIOGRAPHY = [
  '\\begin{thebibliography}{9}',
  '  \\bibitem{key} Author. \\emph{Title}. Publisher, Year.',
  '\\end{thebibliography}',
].join('\n');

export default function LatexEditor({ doc, onDirtyChange }: EditorProps) {
  const file = useTextFile(doc.id, { autosaveMs: 1500 });
  useEffect(() => {
    onDirtyChange?.(file.dirty);
  }, [file.dirty, onDirtyChange]);

  const api = useRef<CodeMirrorApi | null>(null);
  const page = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<SplitView>(() => (window.innerWidth >= 1024 ? 'split' : 'edit'));
  const [wrap, setWrap] = useState(true);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [size, stepSize] = useFontSize('latex', 13);
  const renders = isLatexFile(doc.filename);

  // Debounced, so the page is not rebuilt on every keystroke.
  const [rendered, setRendered] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setRendered(file.text), 250);
    return () => window.clearTimeout(t);
  }, [file.text]);

  const headings = useMemo(() => sourceOutline(file.text), [file.text]);
  // Parsed here only for the count in the status bar; the preview parses its own.
  const skipped = useMemo(() => (renders ? parseLatex(rendered).warnings.length : 0), [renders, rendered]);
  const stats = textStats(file.text);

  const wrapWith = (before: string, after: string, fallback: string) => api.current?.wrapSelection(before, after, fallback);
  const block = (text: string) => api.current?.insertBlock(text);
  const environment = (name: string, body: string) => block(`\\begin{${name}}\n${body}\n\\end{${name}}`);

  const jump = (index: number) => {
    const heading = headings[index];
    if (!heading) return;
    if (view !== 'preview') api.current?.jumpToLine(heading.line);
    page.current?.querySelector(`[data-sec="sec-${index + 1}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (window.innerWidth < 768) setOutlineOpen(false);
  };

  // A `.bib` or `.sty` has nothing to draw: it is edited as source alone.
  const shown: SplitView = renders ? view : 'edit';

  return (
    <Frame
      file={file}
      extra={
        <>
          {renders && skipped > 0 && (
            <span title="Open the note at the top of the page to see what">
              {skipped} thing{skipped === 1 ? '' : 's'} not drawn
            </span>
          )}
          {renders && <span className="hidden md:inline">Quick preview, not a full TeX build</span>}
          <span>{stats.words.toLocaleString()} words · {stats.lines.toLocaleString()} lines</span>
        </>
      }
    >
      <Toolbar>
        {shown !== 'preview' && (
          <>
            <EditButtons api={api} />
            <Divider />
            <ToolButton onClick={() => wrapWith('\\textbf{', '}', 'bold text')} title="Bold"><Bold className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => wrapWith('\\emph{', '}', 'emphasised text')} title="Italic"><Italic className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => wrapWith('\\texttt{', '}', 'code')} title="Monospace"><Code className="h-4 w-4" /></ToolButton>
            <Divider />
            <ToolButton onClick={() => wrapWith('\\section{', '}', 'Section title')} title="Section"><Heading1 className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => wrapWith('\\subsection{', '}', 'Subsection title')} title="Subsection"><Heading2 className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => environment('itemize', '  \\item First\n  \\item Second')} title="Bulleted list"><List className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => environment('enumerate', '  \\item First\n  \\item Second')} title="Numbered list"><ListOrdered className="h-4 w-4" /></ToolButton>
            <Divider />
            <ToolButton onClick={() => wrapWith('$', '$', 'x')} title="Inline math"><Pi className="h-4 w-4" /></ToolButton>
            <ToolButton onClick={() => environment('equation', '  E = mc^2')} title="Numbered equation"><Sigma className="h-4 w-4" /></ToolButton>
            <ToolMenu
              title="Insert"
              items={[
                { label: 'Table', onClick: () => block(latexTable(3, 2)), icon: <Table /> },
                { label: 'Figure', onClick: () => block(FIGURE), icon: <Image /> },
                { label: 'Aligned equations', onClick: () => environment('align', '  a &= b + c \\\\\n  d &= e'), icon: <Sigma /> },
                { label: 'Link', onClick: () => wrapWith('\\href{https://}{', '}', 'link text'), icon: <Link2 />, divider: true },
                { label: 'Footnote', onClick: () => wrapWith('\\footnote{', '}', 'Note text'), icon: <Footprints /> },
                { label: 'Citation', onClick: () => wrapWith('\\cite{', '}', 'key'), icon: <BookOpen /> },
                { label: 'Cross-reference', onClick: () => wrapWith('\\ref{', '}', 'label'), icon: <Hash /> },
                { label: 'Quote', onClick: () => environment('quote', '  Quoted text.'), icon: <Quote />, divider: true },
                { label: 'Code listing', onClick: () => environment('verbatim', 'code'), icon: <SquareCode /> },
                { label: 'Theorem', onClick: () => environment('theorem', '  Statement.'), icon: <Pi /> },
                { label: 'Table of contents', onClick: () => block('\\tableofcontents'), icon: <ListTree />, divider: true },
                { label: 'Reference list', onClick: () => block(BIBLIOGRAPHY), icon: <BookOpen /> },
              ]}
            >
              <Plus className="h-4 w-4" /> <span className="hidden md:inline">Insert</span>
            </ToolMenu>
            <Divider />
            <ToolButton onClick={() => setWrap((w) => !w)} active={wrap} title="Wrap long lines"><WrapText className="h-4 w-4" /></ToolButton>
            <FontButtons size={size} step={stepSize} />
          </>
        )}
        <ToolButton onClick={() => setOutlineOpen((o) => !o)} active={outlineOpen} title="Outline" disabled={headings.length === 0}>
          <ListTree className="h-4 w-4" /> <span className="hidden md:inline">Outline</span>
        </ToolButton>
        <ToolMenu
          title="More"
          items={[
            { label: 'Copy the source', onClick: () => void copyText(file.text, 'LaTeX source'), icon: <Copy /> },
            { label: 'Comment or uncomment', onClick: () => api.current?.toggleComment(), icon: <span className="font-mono text-[12px]">%</span>, disabled: shown === 'preview', hint: 'Ctrl+/' },
            { label: 'Go to line…', onClick: () => api.current?.gotoLine(), icon: <Hash />, disabled: shown === 'preview' },
          ]}
        >
          <MoreHorizontal className="h-4 w-4" />
        </ToolMenu>
        {renders && <ViewSwitch view={view} onChange={setView} options={VIEWS} />}
      </Toolbar>
      <div className="relative flex min-h-0 flex-1">
        {outlineOpen && headings.length > 0 && (
          <nav
            aria-label="Outline"
            className="app-no-print absolute inset-y-0 left-0 z-20 w-60 max-w-[80vw] shrink-0 overflow-auto border-r border-border/60 bg-card p-2 shadow-lg md:static md:w-52 md:shadow-none"
          >
            <ul className="m-0 list-none space-y-0.5 p-0">
              {headings.map((heading, index) => (
                <li key={`${heading.line}:${index}`}>
                  <button
                    type="button"
                    onClick={() => jump(index)}
                    title={`Line ${heading.line}`}
                    style={{ paddingLeft: `${0.5 + Math.max(heading.level - 2, 0) * 0.75}rem` }}
                    className={cn(
                      'block w-full truncate rounded-md py-1.5 pr-2 text-left text-[12.5px] hover:bg-muted',
                      heading.level <= 2 ? 'font-medium text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {heading.title || 'Untitled'}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
        {shown !== 'preview' && (
          <div className={cn('app-no-print flex min-h-0 min-w-0 flex-col', shown === 'split' ? 'w-1/2 border-r border-border/60' : 'flex-1')}>
            <Source file={file} api={api} language="latex" wrap={wrap} fontSize={size} placeholder="Write LaTeX…" />
          </div>
        )}
        {shown !== 'edit' && (
          <div ref={page} className={cn('flex min-h-0 min-w-0 flex-col', shown === 'split' ? 'w-1/2' : 'flex-1')}>
            <Suspense fallback={<EditorLoading label="Drawing the page…" />}>
              <LatexPreview source={rendered} className="flex-1" />
            </Suspense>
          </div>
        )}
      </div>
    </Frame>
  );
}
