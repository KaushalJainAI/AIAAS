/**
 * The inside of a file preview: fetch one document and show it as what it is.
 *
 * Framed by `DocumentPreviewModal` on the Documents page and by
 * `FilePreviewDrawer` beside the chat. It is one component so the two cannot
 * drift — a file an agent just wrote looks the same in the conversation that
 * produced it as it does in the file browser.
 *
 * Decisions carried over from the modal this was extracted from, and still
 * load-bearing:
 *
 * **The bytes come from `download`, not from the serializer's `content`.**
 * `content_text` is what the *extractor* stored, which for CSV is a lossy
 * space-join. `download` returns the real file when one exists and falls back
 * to `content_text` only for rows an agent wrote, where the text *is* the file.
 *
 * **Truncation is always stated, never silent** — and now it can be undone a
 * step at a time with "Show more", because the cap exists to keep the first
 * paint fast, not to decide for the user how much they may read.
 *
 * And one decision new here: **HTML renders, but locked down harder than an
 * artifact.** `HtmlArtifact` allows scripts because the model wrote the markup
 * for display. A file may be someone else's upload shared into the library, so
 * the frame gets an empty `sandbox` (no scripts, forms or popups) and a CSP
 * that refuses every network load — a preview must not be able to phone home,
 * track that it was opened, or draw a login form. Source stays one click away.
 */

import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Check, Copy, FileArchive, FileWarning, Loader2, WrapText } from 'lucide-react';

import { documentsService, type ArchiveListing, type Document } from '../../api/documents';
import MarkdownMessage from '../chat/MarkdownMessage';
import { AuthenticatedMediaPreview } from '../documents/AuthenticatedMediaPreview';
import CodeView from './CodeView';
import OfficePreview from './OfficePreview';
import { CSV_PREVIEW_ROWS, parseCsv } from '../../lib/csv';
import { languageFor, languageForFile } from '../../lib/codeLanguage';
import {
  extensionOfDoc, formatJson, kindOf, legacySentence, parseNotebook,
  type Notebook, type PreviewKind,
} from '../../lib/filePreview';
import { cn } from '../../lib/utils';

// pdf.js stays a lazy chunk: only a PDF preview downloads it.
const PdfJsViewer = lazy(() => import('./PdfJsViewer'));

/** Characters shown on open, and added by each "Show more". */
const PREVIEW_STEP = 200_000;

/** Kinds that have a rendered view as well as their source. */
const RENDERED: ReadonlySet<PreviewKind> = new Set(['markdown', 'csv', 'json', 'html', 'notebook']);

/** Kinds whose source is shown as code rather than as plain text. */
const SOURCE_LANGUAGE: Partial<Record<PreviewKind, string>> = {
  markdown: 'markdown',
  json: 'json',
  html: 'xml',
  notebook: 'json',
};

const HTML_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:";

interface Props {
  doc: Document;
  className?: string;
}

export default function FilePreview({ doc, className }: Props) {
  const kind = useMemo(() => kindOf(doc), [doc]);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(kind !== 'media' && kind !== 'office');
  const [showSource, setShowSource] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [limit, setLimit] = useState(PREVIEW_STEP);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (kind === 'media' || kind === 'office') return;
    let cancelled = false;
    // Callers key this component on the document id, so a different document
    // is a fresh mount whose initial state is already the loading state.
    documentsService
      .download(doc.id)
      .then((blob) => blob.text())
      .then((body) => {
        if (!cancelled) setText(body);
      })
      .catch(() => {
        if (!cancelled) setError('This file could not be read.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [doc.id, kind]);

  const full = text ?? '';
  // Clipped at a block boundary for markdown: a mid-fence cut swallows
  // everything after it, which reads as content (bullets included) vanishing.
  const clipped = useMemo(() => {
    if (kind !== 'markdown' || full.length <= limit) return full.slice(0, limit);
    const cut = full.lastIndexOf('\n\n', limit);
    return (cut > 0 ? full.slice(0, cut) : full.slice(0, limit)).replace(/\s+$/, '');
  }, [full, limit, kind]);
  const truncated = full.length > limit;

  const table = useMemo(
    () => (kind === 'csv' && text !== null ? parseCsv(clipped, CSV_PREVIEW_ROWS) : null),
    [kind, text, clipped],
  );
  const pretty = useMemo(() => (kind === 'json' && text !== null ? formatJson(clipped) : null), [kind, text, clipped]);
  const notebook = useMemo(() => (kind === 'notebook' && text !== null ? parseNotebook(clipped) : null), [kind, text, clipped]);

  // A rendered view that could not be built (a CSV with no rows, JSON that
  // does not parse, a notebook that is not one) falls back to source rather
  // than offering a toggle that leads to nothing.
  const hasRendered =
    RENDERED.has(kind) &&
    !(kind === 'csv' && !table) &&
    !(kind === 'json' && pretty === null) &&
    !(kind === 'notebook' && notebook === null);
  const rendered = hasRendered && !showSource;
  const sourceLanguage = SOURCE_LANGUAGE[kind] ?? languageForFile(doc.filename);
  const showsCode = !rendered || kind === 'json';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard refused (permissions, insecure context). Nothing to undo.
    }
  };

  if (kind === 'office') {
    return <OfficePreview doc={doc} className={className} />;
  }

  if (kind === 'pdf') {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
        <Suspense
          fallback={
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Opening…
            </div>
          }
        >
          <PdfJsViewer docId={doc.id} />
        </Suspense>
      </div>
    );
  }

  if (kind === 'legacy_office') {
    return (
      <div className={cn('p-4', className)}>
        <LegacyOfficeNotice doc={doc} />
      </div>
    );
  }

  if (kind === 'converted_image') {
    return (
      <div className={cn('p-4', className)}>
        <ConvertedImage doc={doc} />
      </div>
    );
  }

  if (kind === 'archive') {
    return (
      <div className={cn('p-4', className)}>
        <ArchiveList doc={doc} />
      </div>
    );
  }

  if (kind === 'media') {
    return (
      <div className={cn('p-4', className)}>
        {doc.file_type === 'other' && (
          <p className="mx-auto mb-3 max-w-2xl rounded-lg border border-border/60 bg-card px-4 py-3 text-center text-[13px] text-muted-foreground">
            No preview for{extensionOfDoc(doc) ? ` .${extensionOfDoc(doc)}` : ''} files
            {doc.file_size ? ` (${formatSize(doc.file_size)})` : ''} — download it to open it.
          </p>
        )}
        <AuthenticatedMediaPreview doc={doc} />
      </div>
    );
  }

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      {text !== null && text.trim() !== '' && (
        <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-3 py-1.5">
          {hasRendered && (
            <div className="flex rounded-md border border-border/60 p-0.5 text-[11px]" role="group" aria-label="View">
              {(['Preview', 'Source'] as const).map((label) => {
                const active = (label === 'Source') === showSource;
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setShowSource(label === 'Source')}
                    className={cn(
                      'rounded px-2 py-0.5 transition-colors',
                      active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {kind === 'json' && label === 'Preview' ? 'Formatted' : label}
                  </button>
                );
              })}
            </div>
          )}
          <span className="ml-1 truncate text-[11px] text-muted-foreground">
            {full.split('\n').length.toLocaleString()} lines · {formatSize(doc.file_size || full.length)}
          </span>
          <div className="ml-auto flex items-center gap-0.5">
            {showsCode && (
              <button
                type="button"
                onClick={() => setWrap((w) => !w)}
                aria-pressed={wrap}
                title={wrap ? 'Don’t wrap lines' : 'Wrap long lines'}
                className={cn(
                  'rounded p-1.5 transition-colors hover:bg-muted',
                  wrap ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <WrapText className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={copy}
              title="Copy file contents"
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <FileWarning className="h-6 w-6" />
            {error}
          </div>
        )}

        {!loading && !error && text !== null && (
          text.trim() === '' ? (
            // An empty file and an unextracted binary look identical if we
            // just render nothing, so say which this could be.
            <p className="px-6 py-16 text-center text-sm text-muted-foreground">
              This file has no text to show. It may be a binary upload that was never
              processed, rather than an empty file.
            </p>
          ) : rendered && kind === 'markdown' ? (
            <div className="px-6 py-5">
              <MarkdownMessage content={clipped} variant="full" />
            </div>
          ) : (kind === 'email' || kind === 'opendocument') ? (
            <div className="px-6 py-5">
              <pre className="m-0 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground/90">
                {clipped}
              </pre>
            </div>
          ) : rendered && kind === 'csv' && table ? (
            <div className="p-4">
              <CsvTableView table={table} />
            </div>
          ) : rendered && kind === 'json' && pretty !== null ? (
            <CodeView code={pretty} language="json" wrap={wrap} />
          ) : rendered && kind === 'html' ? (
            <HtmlFrame html={clipped} title={doc.filename} />
          ) : rendered && kind === 'notebook' && notebook ? (
            <NotebookView notebook={notebook} />
          ) : (
            <CodeView code={clipped} language={sourceLanguage} wrap={wrap} />
          )
        )}

        {!loading && !error && truncated && (
          <div className="flex items-center gap-3 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
            <span>
              Showing the first {limit.toLocaleString()} of {full.length.toLocaleString()} characters.
            </span>
            <button
              type="button"
              onClick={() => setLimit((l) => l + PREVIEW_STEP)}
              className="rounded-md border border-border/60 px-2 py-1 font-medium text-foreground hover:bg-muted"
            >
              Show more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Old Office binaries: the sentence, plus whatever text was recovered. */
function LegacyOfficeNotice({ doc }: { doc: Document }) {
  // The extract, never the bytes: reading an OLE2 binary as text is the zip
  // noise this whole phase exists to stop showing.
  const [text, setText] = useState<string | null>(doc.content ?? null);
  useEffect(() => {
    if (doc.content !== undefined) return;
    let cancelled = false;
    documentsService
      .get(doc.id)
      .then((detail) => {
        if (!cancelled) setText(detail.content ?? '');
      })
      .catch(() => {
        if (!cancelled) setText('');
      });
    return () => {
      cancelled = true;
    };
  }, [doc.id, doc.content]);
  return (
    <div className="mx-auto max-w-2xl px-2 py-6">
      <p className="rounded-lg border border-border/60 bg-card px-4 py-3 text-[13px] text-muted-foreground">
        {legacySentence(doc)}
      </p>
      {text !== null && text.trim() !== '' && (
        <pre className="mt-4 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground/90">
          {text}
        </pre>
      )}
    </div>
  );
}

/** TIFF/BMP/HEIC through the server-side PNG conversion. */
function ConvertedImage({ doc }: { doc: Document }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    documentsService
      .previewImageBlob(doc.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc.id]);
  if (failed) {
    return (
      <div className="mx-auto max-w-2xl px-2 py-6">
        <p className="rounded-lg border border-border/60 bg-card px-4 py-3 text-[13px] text-muted-foreground">
          This image cannot be shown in the browser
          {extensionOfDoc(doc) === 'heic' || extensionOfDoc(doc) === 'heif'
            ? ' (HEIC needs conversion support the server does not have)'
            : ''}
          . Download it to view it.
        </p>
      </div>
    );
  }
  if (!url) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Opening…
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center">
      <img src={url} alt={doc.filename} className="max-h-full max-w-full rounded-md object-contain" />
    </div>
  );
}

/** A zip's entries: names, sizes, dates — never the bytes. */
function ArchiveList({ doc }: { doc: Document }) {
  const [listing, setListing] = useState<ArchiveListing | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    documentsService
      .archive(doc.id)
      .then((body) => {
        if (!cancelled) setListing(body);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [doc.id]);
  if (failed) {
    return <p className="py-10 text-center text-sm text-muted-foreground">This archive could not be read.</p>;
  }
  if (!listing) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Opening…
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-2xl px-2 py-2">
      <p className="mb-3 flex items-center gap-2 text-[13px] text-muted-foreground">
        <FileArchive className="h-4 w-4" />
        {listing.count} {listing.count === 1 ? 'file' : 'files'} inside
        {listing.truncated ? ` — showing the first ${listing.entries.length}` : ''}.
      </p>
      {listing.entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">This archive is empty.</p>
      ) : (
        <ul className="m-0 list-none space-y-0.5 p-0">
          {listing.entries.map((entry) => (
            <li
              key={entry.name}
              className="flex items-baseline gap-3 rounded-md px-2.5 py-1.5 text-[13px] hover:bg-muted/50"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{entry.name}</span>
              <span className="shrink-0 text-[11.5px] text-muted-foreground">{formatSize(entry.size)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HtmlFrame({ html, title }: { html: string; title: string }) {
  const srcDoc = useMemo(
    () =>
      `<!DOCTYPE html><html><head><meta charset="utf-8" />` +
      `<meta http-equiv="Content-Security-Policy" content="${HTML_CSP}" />` +
      `<style>html,body{margin:0;padding:12px;background:#fff;color:#1a1a1a;` +
      `font-family:ui-sans-serif,system-ui,sans-serif;}img{max-width:100%;}</style>` +
      `</head><body>${html}</body></html>`,
    [html],
  );
  return (
    <div className="p-3">
      <iframe
        // Empty sandbox: no scripts, no forms, no popups, and a null origin.
        // See the module note for why this is stricter than HtmlArtifact.
        sandbox=""
        srcDoc={srcDoc}
        title={`Rendered ${title}`}
        className="block h-[65vh] w-full rounded-md border border-border/60 bg-white"
      />
      <p className="mt-2 text-[11px] text-muted-foreground">
        Scripts and network requests are off in this preview.
      </p>
    </div>
  );
}

function NotebookView({ notebook }: { notebook: Notebook }) {
  const language = languageFor(notebook.language) ?? 'python';
  if (notebook.cells.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">This notebook has no cells.</p>;
  }
  return (
    <div className="space-y-3 p-4">
      {notebook.cells.map((cell, i) => (
        <div key={i} className="flex gap-2">
          <span className="w-10 shrink-0 pt-2 text-right font-mono text-[11px] text-muted-foreground/70">
            {cell.type === 'code' ? `[${cell.executionCount ?? ' '}]` : ''}
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            {cell.type === 'markdown' ? (
              <div className="px-1">
                <MarkdownMessage content={cell.source} variant="full" />
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border border-border/60 bg-muted/30">
                <CodeView code={cell.source} language={cell.type === 'code' ? language : null} lineNumbers={false} />
              </div>
            )}
            {cell.outputs.map((out, j) =>
              out.kind === 'image' ? (
                <img key={j} src={out.src} alt={`Output of cell ${i + 1}`} className="max-w-full rounded border border-border/40 bg-white" />
              ) : (
                <pre
                  key={j}
                  className={cn(
                    'm-0 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md px-3 py-2 font-mono text-[12px] leading-[1.5]',
                    out.error ? 'bg-destructive-subtle text-destructive' : 'text-foreground/85',
                  )}
                >
                  {out.text}
                </pre>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function CsvTableView({ table }: { table: ReturnType<typeof parseCsv> }) {
  if (table.headers.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No rows to show.</p>;
  }

  return (
    <div>
      {/* The table scrolls inside its own box; the frame must not scroll
          sideways because one file happens to have forty columns. */}
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-muted/40">
            <tr>
              {table.headers.map((h, i) => (
                <th key={i} className="whitespace-nowrap border-b border-border/60 px-3 py-2 text-left font-semibold">
                  {h || <span className="italic text-muted-foreground">col {i + 1}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r} className={cn(r % 2 === 1 && 'bg-muted/20')}>
                {row.map((cell, c) => (
                  <td key={c} className="border-b border-border/40 px-3 py-1.5 align-top">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {table.truncated
          ? `Showing ${table.rows.length} of ${table.totalRows.toLocaleString()} rows`
          : `${table.totalRows.toLocaleString()} ${table.totalRows === 1 ? 'row' : 'rows'}`}
        {' · '}
        {table.headers.length} {table.headers.length === 1 ? 'column' : 'columns'}
      </p>
    </div>
  );
}
