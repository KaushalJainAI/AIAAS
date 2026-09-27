/**
 * Source code, highlighted, with line numbers.
 *
 * The one code renderer: the chat's fenced blocks, the file preview modal, the
 * chat's file drawer and the edit diff on a file card all draw code through
 * this, so a fix to how code looks lands everywhere at once — the same reason
 * `MarkdownMessage` is the one markdown renderer.
 *
 * Three decisions worth keeping:
 *
 * **Plain first, colour when it arrives.** The highlighter is a lazy chunk
 * (`lib/highlight.ts`). Code renders immediately as plain text and is
 * re-rendered highlighted when the chunk lands, so a slow network costs colour,
 * never content.
 *
 * **Highlighting has a ceiling.** Past `HIGHLIGHT_MAX_CHARS` the text stays
 * plain: highlighting is synchronous, and a 2 MB log would freeze the tab for
 * colour nobody reads at that size.
 *
 * **Line numbers are a separate column, not per-line spans.** Splitting the
 * highlighted HTML at newlines would cut through tokens that span lines (block
 * comments, docstrings) and leave unbalanced tags. A gutter beside one `<pre>`
 * keeps the markup whole. Wrapped lines cannot line up with a gutter, so
 * wrapping turns the gutter off.
 */

import { useEffect, useMemo, useState } from 'react';
import { cn } from '../../lib/utils';

const HIGHLIGHT_MAX_CHARS = 150_000;

type HighlightFn = (code: string, language: string) => string | null;

let loader: Promise<HighlightFn> | null = null;
let loaded: HighlightFn | null = null;

function loadHighlighter(): Promise<HighlightFn> {
  loader ??= import('../../lib/highlight').then((m) => {
    loaded = m.highlight;
    return m.highlight;
  });
  return loader;
}

/** The highlighter once its chunk has loaded; null until then. */
function useHighlighter(wanted: boolean): HighlightFn | null {
  const [fn, setFn] = useState<HighlightFn | null>(() => loaded);
  useEffect(() => {
    if (!wanted || fn) return;
    let cancelled = false;
    loadHighlighter()
      .then((h) => {
        if (!cancelled) setFn(() => h);
      })
      .catch(() => {
        // A failed chunk load leaves the code plain, which is still correct.
      });
    return () => {
      cancelled = true;
    };
  }, [wanted, fn]);
  return fn;
}

interface Props {
  code: string;
  /** Grammar name from `lib/codeLanguage.ts`; null renders plain text. */
  language: string | null;
  /** Default true; a very short snippet reads better without them. */
  lineNumbers?: boolean;
  wrap?: boolean;
  className?: string;
}

export default function CodeView({
  code,
  language,
  lineNumbers = true,
  wrap = false,
  className,
}: Props) {
  const text = code.replace(/\n$/, '');
  const wantsColour = language !== null && text.length <= HIGHLIGHT_MAX_CHARS;
  const highlighter = useHighlighter(wantsColour);

  const html = useMemo(
    () => (wantsColour && highlighter && language ? highlighter(text, language) : null),
    [wantsColour, highlighter, language, text],
  );

  const lineCount = useMemo(() => text.split('\n').length, [text]);
  const gutter = lineNumbers && !wrap;

  const codeClass = cn(
    'hljs block font-mono text-[12.5px] leading-[1.6] py-3 pr-4',
    gutter ? 'pl-3' : 'pl-4',
    wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre',
  );

  return (
    <div className={cn('flex min-w-0 overflow-auto custom-scrollbar', className)}>
      {gutter && (
        <pre
          aria-hidden="true"
          className="sticky left-0 z-10 m-0 shrink-0 select-none border-r border-border/50 bg-muted/60 py-3 pl-3 pr-2 text-right font-mono text-[12.5px] leading-[1.6] text-muted-foreground/60"
        >
          {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
        </pre>
      )}
      <pre className="m-0 min-w-0 flex-1 bg-transparent">
        {html !== null ? (
          // Safe: highlight.js escapes the source and adds only its own spans.
          <code className={codeClass} dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code className={codeClass}>{text}</code>
        )}
      </pre>
    </div>
  );
}
