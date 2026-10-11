/**
 * A `.tex` file drawn as a page: structure from `lib/latex.ts`, math by KaTeX.
 *
 * A lazy chunk — KaTeX and its fonts load only when LaTeX is on screen. It is
 * a reading view, not a TeX build: page breaks, custom packages and TikZ are
 * not reproduced, and whatever the reader skipped is listed at the top rather
 * than left for the user to notice missing.
 *
 * Everything is rendered as React nodes except KaTeX's own output, which
 * KaTeX escapes; `trust` is off, so a formula cannot carry a link or an image.
 */
import { Fragment, useMemo, type ReactNode } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { ImageIcon } from 'lucide-react';

import { parseLatex, type Block, type Inline, type LatexDoc } from '../../lib/latex';
import { cn } from '../../lib/utils';

const STYLE_CLASS: Record<string, string> = {
  bold: 'font-semibold',
  italic: 'italic',
  code: 'rounded bg-muted px-1 py-0.5 font-mono text-[0.88em]',
  underline: 'underline underline-offset-2',
  smallcaps: '[font-variant:small-caps]',
  strike: 'line-through',
};

const HEADING_CLASS = [
  'mt-10 mb-4 text-[1.7em] font-bold leading-tight',
  'mt-8 mb-3 text-[1.35em] font-bold leading-snug',
  'mt-6 mb-2 text-[1.15em] font-bold leading-snug',
  'mt-5 mb-2 text-[1.02em] font-bold',
  'mt-4 mb-1 text-[1em] font-bold',
];

type Tex = (source: string, display: boolean) => string;

/** KaTeX output per document, so a formula is typeset once however often the page redraws. */
const RENDERED = new WeakMap<LatexDoc, Map<string, string>>();

function typeset(doc: LatexDoc, source: string, display: boolean): string {
  let cache = RENDERED.get(doc);
  if (!cache) {
    cache = new Map();
    RENDERED.set(doc, cache);
  }
  const key = `${display ? 'd' : 'i'}${source}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let html: string;
  try {
    html = katex.renderToString(source, {
      displayMode: display,
      throwOnError: false,
      errorColor: '#dc2626',
      // KaTeX writes `\gdef`s back into this object, so it gets a copy.
      macros: { ...doc.macros },
      trust: false,
      strict: 'ignore',
      maxExpand: 500,
      maxSize: 20,
    });
  } catch {
    html = '';
  }
  cache.set(key, html);
  return html;
}

function Inlines({ nodes, doc, tex }: { nodes: Inline[]; doc: LatexDoc; tex: Tex }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text':
            return <Fragment key={i}>{n.v}</Fragment>;
          case 'math': {
            const html = tex(n.v, false);
            return html
              ? <span key={i} dangerouslySetInnerHTML={{ __html: html }} />
              : <code key={i} className="text-destructive">{n.v}</code>;
          }
          case 'style':
            if (n.s === 'sup') return <sup key={i}><Inlines nodes={n.c} doc={doc} tex={tex} /></sup>;
            if (n.s === 'sub') return <sub key={i}><Inlines nodes={n.c} doc={doc} tex={tex} /></sub>;
            return <span key={i} className={STYLE_CLASS[n.s]}><Inlines nodes={n.c} doc={doc} tex={tex} /></span>;
          case 'link':
            return (
              <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                <Inlines nodes={n.c} doc={doc} tex={tex} />
              </a>
            );
          case 'footnote':
            return <sup key={i} className="text-primary">{n.n}</sup>;
          case 'ref': {
            const value = doc.labels[n.label] || '??';
            return <Fragment key={i}>{n.paren ? `(${value})` : value}</Fragment>;
          }
          case 'cite':
            return <Fragment key={i}>[{n.keys.map((k) => doc.cites[k] ?? k).join(', ')}]</Fragment>;
          case 'code':
            return <code key={i} className={STYLE_CLASS.code}>{n.v}</code>;
          case 'image':
            return <ImageNote key={i} file={n.file} inline />;
          case 'break':
            return <br key={i} />;
          default:
            return null;
        }
      })}
    </>
  );
}

function ImageNote({ file, inline }: { file: string; inline?: boolean }) {
  const Tag = inline ? 'span' : 'div';
  return (
    <Tag
      className={cn(
        'items-center gap-1.5 rounded-md border border-dashed border-border bg-muted/40 px-2.5 py-1.5 font-sans text-[12px] text-muted-foreground',
        inline ? 'inline-flex' : 'mx-auto flex w-fit',
      )}
      title="Images are not loaded in the preview"
    >
      <ImageIcon className="h-3.5 w-3.5 shrink-0" /> {file}
    </Tag>
  );
}

function Blocks({ blocks, doc, tex }: { blocks: Block[]; doc: LatexDoc; tex: Tex }) {
  const inl = (nodes: Inline[]): ReactNode => <Inlines nodes={nodes} doc={doc} tex={tex} />;
  const nested = (inner: Block[]): ReactNode => <Blocks blocks={inner} doc={doc} tex={tex} />;
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'title':
            return (
              <header key={i} className="mb-8 text-center">
                <h1 className="text-[2em] font-bold leading-tight">{inl(b.title)}</h1>
                {b.author && <p className="mt-3 text-[1.1em]">{inl(b.author)}</p>}
                {b.date && <p className="mt-1 text-[0.95em] text-muted-foreground">{inl(b.date)}</p>}
              </header>
            );
          case 'heading': {
            const Tag = (`h${Math.min(b.level + 1, 6)}`) as 'h2';
            return (
              <Tag key={i} data-sec={b.id} className={cn(HEADING_CLASS[b.level - 1], 'scroll-mt-4')}>
                {b.number && <span className="mr-3">{b.number}</span>}
                {inl(b.c)}
              </Tag>
            );
          }
          case 'para':
            return <p key={i} className="my-3 text-justify leading-[1.65] [hyphens:auto]">{inl(b.c)}</p>;
          case 'math': {
            const html = tex(b.v, true);
            return html
              ? <div key={i} className="my-4 overflow-x-auto overflow-y-hidden py-1" dangerouslySetInnerHTML={{ __html: html }} />
              : <pre key={i} className="my-4 overflow-x-auto text-[0.85em] text-destructive">{b.v}</pre>;
          }
          case 'list': {
            const Tag = b.ordered ? 'ol' : 'ul';
            return (
              <Tag key={i} className={cn('my-3 space-y-1 pl-7', b.ordered ? 'list-decimal' : 'list-disc')}>
                {b.items.map((item, j) => <li key={j} className="[&>p:first-child]:mt-0 [&>p:last-child]:mb-0">{nested(item)}</li>)}
              </Tag>
            );
          }
          case 'desc':
            return (
              <dl key={i} className="my-3 space-y-2">
                {b.items.map((item, j) => (
                  <div key={j}>
                    <dt className="font-bold">{inl(item.term)}</dt>
                    <dd className="pl-6 [&>p:first-child]:mt-0.5">{nested(item.body)}</dd>
                  </div>
                ))}
              </dl>
            );
          case 'box':
            if (b.kind === 'abstract') {
              return (
                <section key={i} className="mx-auto my-6 max-w-[85%] text-[0.94em]">
                  <p className="mb-1 text-center font-bold">Abstract</p>
                  {nested(b.c)}
                </section>
              );
            }
            if (b.kind === 'center') return <div key={i} className="my-3 text-center [&_p]:text-center [&_table]:mx-auto">{nested(b.c)}</div>;
            return <blockquote key={i} className="my-4 border-l-2 border-border pl-4 text-muted-foreground">{nested(b.c)}</blockquote>;
          case 'theorem': {
            const proof = b.label.startsWith('Proof');
            return (
              <div key={i} className={cn('my-4', !proof && 'italic')}>
                <p className="mb-1 font-bold not-italic">{b.label}.</p>
                {nested(b.c)}
                {proof && <p className="text-right" aria-label="End of proof">∎</p>}
              </div>
            );
          }
          case 'code':
            return <pre key={i} className="my-4 overflow-x-auto rounded-md bg-muted/60 p-3 font-mono text-[0.82em] leading-relaxed">{b.v}</pre>;
          case 'table':
            return (
              <div key={i} className="my-4 overflow-x-auto">
                <table className="mx-auto border-collapse border-y-2 border-foreground/70 text-[0.94em]">
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r} className={cn(b.header && r === 0 && 'border-b border-foreground/70 font-semibold')}>
                        {row.map((cell, c) => (
                          <td key={c} colSpan={cell.span > 1 ? cell.span : undefined} className={cn('px-3 py-1.5 align-top', cell.span > 1 && 'text-center')}>
                            {inl(cell.c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'float':
            return (
              <figure key={i} className="my-6 text-center [&_table]:mx-auto">
                {b.files.map((file) => <ImageNote key={file} file={file} />)}
                {nested(b.c)}
                <figcaption className="mt-2 text-[0.92em]">
                  <span className="font-semibold">{b.label}{b.caption ? ': ' : ''}</span>
                  {b.caption && inl(b.caption)}
                </figcaption>
              </figure>
            );
          case 'bibliography':
            return (
              <section key={i} className="mt-8">
                <h2 className={HEADING_CLASS[1]}>References</h2>
                <ol className="space-y-1.5 text-[0.94em]">
                  {b.items.map((item, j) => (
                    <li key={j} className="flex gap-2">
                      <span className="shrink-0">[{j + 1}]</span>
                      <span>{inl(item.c)}</span>
                    </li>
                  ))}
                </ol>
              </section>
            );
          case 'toc':
            return (
              <nav key={i} className="my-6" aria-label="Contents">
                <p className={HEADING_CLASS[1]}>Contents</p>
                <ul className="space-y-1">
                  {doc.outline.map((o) => (
                    <li key={o.id} style={{ paddingLeft: `${Math.max(o.level - 2, 0) * 1.25}rem` }}>
                      {o.number && <span className="mr-2">{o.number}</span>}
                      {o.text}
                    </li>
                  ))}
                </ul>
              </nav>
            );
          case 'note':
            return <p key={i} className="my-4 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-center font-sans text-[12.5px] text-muted-foreground">{b.v}</p>;
          case 'rule':
            return <hr key={i} className="my-5 border-border" />;
          default:
            return null;
        }
      })}
    </>
  );
}

interface Props {
  source: string;
  className?: string;
  /** Hide the "what was skipped" disclosure (the editor shows its own count). */
  quiet?: boolean;
}

export default function LatexPreview({ source, className, quiet }: Props) {
  const doc = useMemo(() => parseLatex(source), [source]);
  const tex = useMemo<Tex>(() => (source, display) => typeset(doc, source, display), [doc]);
  const empty = doc.blocks.length === 0;

  return (
    <div className={cn('min-h-0 overflow-auto bg-muted/30 px-3 py-4 sm:px-6 sm:py-8', className)}>
      {!quiet && doc.warnings.length > 0 && (
        <details className="mx-auto mb-3 max-w-[46rem] rounded-md border border-border/60 bg-card px-3 py-2 text-[12px] text-muted-foreground">
          <summary className="cursor-pointer select-none">
            This preview left out {doc.warnings.length} thing{doc.warnings.length === 1 ? '' : 's'} it does not draw
          </summary>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {doc.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </details>
      )}
      <article
        className="latex-page mx-auto max-w-[46rem] rounded-sm border border-border/50 bg-card px-6 py-8 text-[15px] text-foreground shadow-sm sm:px-14 sm:py-12"
        style={{ fontFamily: '"Latin Modern Roman", "CMU Serif", "Computer Modern", Georgia, "Times New Roman", serif' }}
      >
        {empty ? (
          <p className="text-center font-sans text-sm text-muted-foreground">Nothing to show yet.</p>
        ) : (
          <>
            <Blocks blocks={doc.blocks} doc={doc} tex={tex} />
            {doc.footnotes.length > 0 && (
              <footer className="mt-10 border-t border-border pt-3 text-[0.88em]">
                <ol className="space-y-1">
                  {doc.footnotes.map((note, i) => (
                    <li key={i} className="flex gap-2">
                      <sup className="mt-1.5 shrink-0">{i + 1}</sup>
                      <span><Inlines nodes={note} doc={doc} tex={tex} /></span>
                    </li>
                  ))}
                </ol>
              </footer>
            )}
          </>
        )}
      </article>
    </div>
  );
}
