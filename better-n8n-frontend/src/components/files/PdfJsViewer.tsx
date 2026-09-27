/**
 * Every PDF on every device: pdf.js (Apache-2.0) instead of the browser's
 * built-in viewer, which shows nothing inside a page on most phones. The same
 * reader serves the file preview and the PDF Reader app, and only this file
 * pulls in pdf.js, lazily, so no other page downloads it.
 *
 * What it does, and why each part is the way it is:
 *
 * * **One worker per document.** It used to hand pdf.js a single shared
 *   `workerPort`. pdf.js caches one `PDFWorker` per port and *destroys* it
 *   when any document using it is closed, so switching files, closing a
 *   preview or React's StrictMode remount killed the worker under whatever
 *   was open next: "This PDF could not be opened", or pages that never drew.
 *   `workerSrc` makes pdf.js start a worker per document and end it with it.
 * * **Run-time data is served** (`/pdfjs/...`, see `vite.config.ts`):
 *   character maps, standard fonts, colour profiles and the JPEG 2000 / JBIG2
 *   decoders. Without them scanned PDFs showed blank pages and CJK text went
 *   missing.
 * * **A continuous scroll, fitted to the width**, like any PDF reader, rather
 *   than one page at a fixed 150% that overflowed a phone. Pages draw when
 *   they come near the viewport and are released when they leave it, so a
 *   500-page file does not hold 500 canvases.
 * * **Selectable text** via pdf.js's text layer, so copy and the browser's
 *   own find work, and search highlights its matches.
 * * **Password-protected files ask for the password.** pdf.js waits on
 *   `onPassword`, and with no handler the reader said "Opening…" for ever.
 * * **It reopens where it was left**: the page and zoom are saved to the
 *   user's recents (`useViewState`) as they change.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  GlobalWorkerOptions,
  PasswordResponses,
  TextLayer,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2, Lock, MoveHorizontal, PanelLeft, Search, ZoomIn, ZoomOut,
} from 'lucide-react';

import { documentsService } from '../../api/documents';
import type { ViewState } from '../../api/recents';
import { useViewState } from '../../hooks/useRecents';
import { apiErrorMessage } from '../../lib/apiError';
import {
  canvasOutputScale, fitScale, matchingPages, pageAt, parseViewState, stepZoom, type Zoom,
} from '../../lib/pdfView';
import { cn } from '../../lib/utils';
import './pdfViewer.css';

GlobalWorkerOptions.workerSrc = workerUrl;

const ASSETS = {
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
  wasmUrl: '/pdfjs/wasm/',
  iccUrl: '/pdfjs/iccs/',
};

// Pages whose exact size is read before the first scroll restore; past this
// the rest are assumed to match the first page (a 5,000-page scan).
const SIZE_SCAN_CAP = 2000;
const THUMB_WIDTH = 88;
const THUMBNAIL_CAP = 500;

interface Size {
  w: number;
  h: number;
}

interface PasswordRequest {
  /** Counts prompts, so a retry after a wrong password is a fresh form. */
  attempt: number;
  wrong: boolean;
  submit: (password: string) => void;
}

function describeError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'InvalidPDFException') return 'This file is not a readable PDF. It may be damaged, or not really a PDF.';
  if (name === 'ResponseException' || name === 'MissingPDFException') return 'This PDF could not be downloaded.';
  return apiErrorMessage(err, 'This PDF could not be opened.');
}

function usePdfDocument(docId: number) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState<PasswordRequest | null>(null);
  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    let attempt = 0;
    documentsService
      .download(docId, { inline: true })
      .then((blob) => blob.arrayBuffer())
      .then((bytes) => {
        if (cancelled) return null;
        task = getDocument({ data: new Uint8Array(bytes), ...ASSETS });
        task.onPassword = (submit: (pw: string) => void, reason: number) => {
          attempt += 1;
          if (!cancelled) setPassword({ attempt, wrong: reason === PasswordResponses.INCORRECT_PASSWORD, submit });
        };
        return task.promise;
      })
      .then((loaded) => {
        if (cancelled || !loaded) return;
        setPassword(null);
        setPdf(loaded);
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err));
      });
    return () => {
      cancelled = true;
      // Destroying the task ends this document's own worker; nothing else uses it.
      if (task) void task.destroy();
    };
  }, [docId]);
  return { pdf, error, password };
}

export default function PdfJsViewer({ docId }: { docId: number }) {
  const { pdf, error, password } = usePdfDocument(docId);
  const saved = useViewState(docId);

  if (error) {
    return <p className="px-6 py-16 text-center text-sm text-muted-foreground">{error}</p>;
  }
  if (password && !pdf) {
    return <PasswordPrompt key={password.attempt} request={password} />;
  }
  if (!pdf || !saved.ready) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Opening…
      </div>
    );
  }
  return <Reader pdf={pdf} initial={saved.initial} onState={saved.save} />;
}

function PasswordPrompt({ request }: { request: PasswordRequest }) {
  const [value, setValue] = useState('');
  const [sent, setSent] = useState(false);
  return (
    <form
      className="mx-auto flex w-full max-w-xs flex-col items-center gap-3 px-6 py-16 text-center"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value) return;
        setSent(true);
        request.submit(value);
      }}
    >
      <Lock className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">This PDF is password-protected</p>
      {request.wrong && <p className="text-[12.5px] text-destructive">That password did not work. Try again.</p>}
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        aria-label="PDF password"
        placeholder="Password"
        className="h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm outline-none focus:border-primary"
      />
      <button
        type="submit"
        disabled={!value || sent}
        className="h-9 w-full rounded-md bg-primary text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {sent ? 'Opening…' : 'Open'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

function usePageSizes(pdf: PDFDocumentProxy) {
  const [sizes, setSizes] = useState<Size[] | null>(null);
  const [complete, setComplete] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const n = pdf.numPages;
      const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
      const out: Size[] = Array.from({ length: n }, () => ({ w: first.width, h: first.height }));
      if (cancelled) return;
      setSizes([...out]);
      const last = Math.min(n, SIZE_SCAN_CAP);
      for (let start = 2; start <= last; start += 25) {
        const batch = [];
        for (let k = start; k < Math.min(start + 25, last + 1); k += 1) batch.push(pdf.getPage(k));
        const pages = await Promise.all(batch);
        if (cancelled) return;
        for (const p of pages) {
          const v = p.getViewport({ scale: 1 });
          out[p.pageNumber - 1] = { w: v.width, h: v.height };
        }
      }
      setSizes([...out]);
      setComplete(true);
    })().catch(() => {
      if (!cancelled) setComplete(true);
    });
    return () => {
      cancelled = true;
    };
  }, [pdf]);
  return { sizes, complete };
}

function Reader({ pdf, initial, onState }: {
  pdf: PDFDocumentProxy;
  initial: ViewState;
  onState: (s: ViewState) => void;
}) {
  const pages = pdf.numPages;
  const start = useMemo(() => parseViewState(initial, pages), [initial, pages]);
  const [zoom, setZoom] = useState<Zoom>(start.zoom);
  const [page, setPage] = useState(start.page);
  const [pageInput, setPageInput] = useState(String(start.page));
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [thumbsOpen, setThumbsOpen] = useState(() => pages > 1 && window.innerWidth >= 1024);
  const { sizes, complete } = usePageSizes(pdf);
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const restored = useRef(false);

  // Search state.
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<number[] | null>(null);
  const [hitIndex, setHitIndex] = useState(0);
  const [searched, setSearched] = useState('');
  const [searching, setSearching] = useState(false);
  const texts = useRef<Map<number, string>>(new Map());

  // Width, in 8px steps so a resizing window does not redraw every frame.
  useEffect(() => {
    if (!scroller) return;
    const measure = () => setWidth(Math.floor(scroller.clientWidth / 8) * 8);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [scroller]);

  const baseWidth = sizes?.[0]?.w ?? 612;
  const scale = zoom === 'fit' ? fitScale(width, baseWidth) : zoom;

  const goToPage = useCallback(
    (n: number) => {
      const target = Math.min(pages, Math.max(1, n));
      const el = pageEls.current[target - 1];
      if (scroller && el) scroller.scrollTo({ top: el.offsetTop - 12 });
      setPage(target);
      setPageInput(String(target));
    },
    [pages, scroller],
  );

  // Reopen on the page it was left at, once every page has its real size.
  useEffect(() => {
    if (restored.current || !complete || !scroller || width === 0) return;
    restored.current = true;
    if (start.page > 1) requestAnimationFrame(() => goToPage(start.page));
  }, [complete, scroller, width, start.page, goToPage]);

  // Track the page in view as the reader scrolls.
  useEffect(() => {
    if (!scroller) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const tops = pageEls.current.map((el) => el?.offsetTop ?? 0);
        const n = pageAt(tops, scroller.scrollTop + scroller.clientHeight * 0.35);
        setPage(n);
        setPageInput(String(n));
      });
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [scroller]);

  // Save where the reader is, once the saved position has been applied.
  useEffect(() => {
    if (!restored.current) return;
    onState({ page, zoom });
  }, [page, zoom, onState]);

  const zoomBy = (dir: 1 | -1) => {
    const anchor = page;
    setZoom(stepZoom(scale, dir));
    requestAnimationFrame(() => requestAnimationFrame(() => goToPage(anchor)));
  };

  const pageText = useCallback(
    async (n: number) => {
      const cached = texts.current.get(n);
      if (cached !== undefined) return cached;
      const content = await pdf.getPage(n).then((p) => p.getTextContent());
      const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
      texts.current.set(n, text);
      return text;
    },
    [pdf],
  );

  const search = async () => {
    const needle = query.trim();
    if (!needle) {
      setHits(null);
      setSearched('');
      return;
    }
    if (hits && searched === needle && hits.length > 0) {
      // Enter again on the same words steps to the next match.
      const next = (hitIndex + 1) % hits.length;
      setHitIndex(next);
      goToPage(hits[next]);
      return;
    }
    setSearching(true);
    try {
      const all: string[] = [];
      for (let n = 1; n <= pages; n += 1) all.push(await pageText(n));
      const found = matchingPages(all, needle);
      setHits(found);
      setSearched(needle);
      setHitIndex(0);
      if (found.length > 0) goToPage(found[0]);
    } finally {
      setSearching(false);
    }
  };

  const stepHit = (dir: 1 | -1) => {
    if (!hits || hits.length === 0) return;
    const next = (hitIndex + dir + hits.length) % hits.length;
    setHitIndex(next);
    goToPage(hits[next]);
  };

  const btn = 'rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/60 bg-card px-2 py-1.5">
        {pages > 1 && (
          <button
            type="button"
            onClick={() => setThumbsOpen((o) => !o)}
            aria-label={thumbsOpen ? 'Hide page thumbnails' : 'Show page thumbnails'}
            aria-pressed={thumbsOpen}
            className={cn(btn, 'hidden sm:inline-flex', thumbsOpen && 'bg-muted text-foreground')}
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        )}
        <button type="button" onClick={() => goToPage(page - 1)} disabled={page <= 1} aria-label="Previous page" className={btn}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <form
          className="flex items-center gap-1 text-[12px] text-muted-foreground"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(pageInput);
            if (Number.isInteger(n)) goToPage(n);
            else setPageInput(String(page));
          }}
        >
          <input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ''))}
            onBlur={() => setPageInput(String(page))}
            inputMode="numeric"
            aria-label="Page number"
            className="h-7 w-10 rounded border border-border/60 bg-background text-center text-[12px] text-foreground outline-none focus:border-primary"
          />
          <span aria-live="polite">/ {pages}</span>
        </form>
        <button type="button" onClick={() => goToPage(page + 1)} disabled={page >= pages} aria-label="Next page" className={btn}>
          <ChevronRight className="h-4 w-4" />
        </button>
        <span className="mx-1 h-5 w-px bg-border/60" aria-hidden />
        <button type="button" onClick={() => zoomBy(-1)} aria-label="Zoom out" className={btn}>
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="w-11 text-center text-[12px] text-muted-foreground">{Math.round(scale * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1)} aria-label="Zoom in" className={btn}>
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            const anchor = page;
            setZoom('fit');
            requestAnimationFrame(() => requestAnimationFrame(() => goToPage(anchor)));
          }}
          aria-label="Fit to width"
          aria-pressed={zoom === 'fit'}
          title="Fit to width"
          className={cn(btn, zoom === 'fit' && 'bg-muted text-foreground')}
        >
          <MoveHorizontal className="h-4 w-4" />
        </button>
        <form
          className="ml-auto flex min-w-0 items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <div className="flex h-8 items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 focus-within:border-primary">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find in PDF"
              aria-label="Find in PDF"
              className="w-28 bg-transparent text-[12.5px] outline-none sm:w-40"
            />
            {searching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          {hits && hits.length > 0 && (
            <>
              <span className="whitespace-nowrap px-1 text-[11.5px] text-muted-foreground" aria-live="polite">
                {hitIndex + 1}/{hits.length}
              </span>
              <button type="button" onClick={() => stepHit(-1)} aria-label="Previous match" className={btn}>
                <ChevronUp className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => stepHit(1)} aria-label="Next match" className={btn}>
                <ChevronDown className="h-4 w-4" />
              </button>
            </>
          )}
        </form>
      </div>
      {hits !== null && hits.length === 0 && (
        <p className="shrink-0 border-b border-border/60 bg-card px-4 py-1.5 text-[12px] text-muted-foreground" aria-live="polite">
          No matches for “{searched}”.
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        {thumbsOpen && pages > 1 && sizes && (
          <ThumbnailStrip pdf={pdf} sizes={sizes} page={page} onSelect={goToPage} />
        )}
        <div
          ref={setScroller}
          tabIndex={0}
          aria-label="PDF pages"
          className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-muted/40 py-3 outline-none"
        >
          {sizes && scroller && (
            <div className="flex flex-col items-center gap-3 px-4">
              {sizes.map((size, i) => (
                <PageSlot
                  key={i + 1}
                  ref={(el) => {
                    pageEls.current[i] = el;
                  }}
                  pdf={pdf}
                  number={i + 1}
                  size={size}
                  scale={scale}
                  root={scroller}
                  highlight={hits && hits.includes(i + 1) ? searched : ''}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One page: a placeholder at its final size, drawn when near the viewport
// ---------------------------------------------------------------------------

function markHits(layer: HTMLElement | null, needle: string) {
  if (!layer) return;
  const n = needle.trim().toLowerCase();
  for (const span of layer.querySelectorAll('span')) {
    span.classList.toggle('pdf-hit', !!n && (span.textContent ?? '').toLowerCase().includes(n));
  }
}

function PageSlot({ ref, pdf, number, size, scale, root, highlight }: {
  ref: (el: HTMLDivElement | null) => void;
  pdf: PDFDocumentProxy;
  number: number;
  size: Size;
  scale: number;
  root: HTMLElement;
  highlight: string;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const canvasHolder = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [failed, setFailed] = useState(false);
  // Read by the draw effect once its text layer exists; kept current below.
  const highlightRef = useRef(highlight);

  // Draw within two screens of the viewport; release beyond that.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      root,
      rootMargin: '200% 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    const holder = canvasHolder.current;
    const layer = textLayerRef.current;
    if (!holder || !layer) return;
    if (!near) {
      holder.replaceChildren();
      layer.replaceChildren();
      return;
    }
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    let textLayer: TextLayer | null = null;
    (async () => {
      const pg = await pdf.getPage(number);
      if (cancelled) return;
      const viewport = pg.getViewport({ scale });
      const out = canvasOutputScale(viewport.width, viewport.height, window.devicePixelRatio);
      // A fresh canvas per draw: pdf.js refuses two renders into one canvas,
      // and a zoom can start the next before the last has finished cancelling.
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * out);
      canvas.height = Math.floor(viewport.height * out);
      // Sized by its box, so while a zoom redraws, the old picture stretches
      // to the new size instead of sitting small in a corner.
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.display = 'block';
      renderTask = pg.render({ canvas, viewport, transform: out === 1 ? undefined : [out, 0, 0, out, 0, 0] });
      await renderTask.promise;
      if (cancelled) return;
      holder.replaceChildren(canvas);
      setFailed(false);

      layer.replaceChildren();
      textLayer = new TextLayer({ textContentSource: pg.streamTextContent(), container: layer, viewport });
      await textLayer.render();
      if (cancelled) return;
      markHits(layer, highlightRef.current);
    })().catch((err: unknown) => {
      const name = (err as { name?: string } | null)?.name;
      if (!cancelled && name !== 'RenderingCancelledException' && name !== 'AbortException') setFailed(true);
    });
    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // Already finished: cancelling a done task throws, harmlessly.
      }
      textLayer?.cancel();
    };
  }, [near, pdf, number, scale]);

  useEffect(() => {
    highlightRef.current = highlight;
    markHits(textLayerRef.current, highlight);
  }, [highlight]);

  const w = Math.floor(size.w * scale);
  const h = Math.floor(size.h * scale);
  return (
    <div
      ref={(el) => {
        box.current = el;
        ref(el);
      }}
      data-page={number}
      role="group"
      aria-label={`Page ${number}`}
      className="pdf-page relative shrink-0 overflow-hidden rounded-sm bg-white shadow-md"
      style={{ width: w, height: h, '--scale-factor': scale } as CSSProperties}
    >
      <div ref={canvasHolder} className="absolute inset-0" />
      <div ref={textLayerRef} className="textLayer" />
      {failed && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          This page could not be drawn.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------

function ThumbnailStrip({ pdf, sizes, page, onSelect }: {
  pdf: PDFDocumentProxy;
  sizes: Size[];
  page: number;
  onSelect: (n: number) => void;
}) {
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  const count = Math.min(sizes.length, THUMBNAIL_CAP);

  // Keep the current page's thumbnail in view as the reader scrolls.
  useEffect(() => {
    const el = strip?.querySelector<HTMLElement>(`[data-thumb="${page}"]`);
    if (!strip || !el) return;
    const top = el.offsetTop - strip.offsetTop;
    if (top < strip.scrollTop || top + el.offsetHeight > strip.scrollTop + strip.clientHeight) {
      strip.scrollTo({ top: top - strip.clientHeight / 3 });
    }
  }, [page, strip]);

  return (
    <div
      ref={setStrip}
      className="hidden w-28 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-border/60 bg-card p-2 sm:flex"
      aria-label="Page thumbnails"
    >
      {strip &&
        Array.from({ length: count }, (_, i) => (
          <Thumb key={i + 1} pdf={pdf} number={i + 1} size={sizes[i]} active={i + 1 === page} root={strip} onSelect={onSelect} />
        ))}
      {sizes.length > THUMBNAIL_CAP && (
        <p className="px-1 text-center text-[11px] text-muted-foreground">+{sizes.length - THUMBNAIL_CAP} more</p>
      )}
    </div>
  );
}

function Thumb({ pdf, number, size, active, root, onSelect }: {
  pdf: PDFDocumentProxy;
  number: number;
  size: Size;
  active: boolean;
  root: HTMLElement;
  onSelect: (n: number) => void;
}) {
  const box = useRef<HTMLButtonElement>(null);
  const holder = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);
  const scale = THUMB_WIDTH / size.w;

  useEffect(() => {
    const el = box.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setSeen(true);
    }, { root, rootMargin: '100% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [root, seen]);

  useEffect(() => {
    if (!seen || !holder.current) return;
    const target = holder.current;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    pdf
      .getPage(number)
      .then((pg) => {
        if (cancelled) return;
        const viewport = pg.getViewport({ scale });
        const out = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width * out);
        canvas.height = Math.floor(viewport.height * out);
        canvas.style.width = '100%';
        canvas.style.display = 'block';
        const r = pg.render({ canvas, viewport, transform: out === 1 ? undefined : [out, 0, 0, out, 0, 0] });
        task = r;
        return r.promise.then(() => {
          if (!cancelled) target.replaceChildren(canvas);
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      try {
        task?.cancel();
      } catch {
        // Already finished.
      }
    };
  }, [seen, pdf, number, scale]);

  return (
    <button
      ref={box}
      type="button"
      data-thumb={number}
      onClick={() => onSelect(number)}
      aria-label={`Go to page ${number}`}
      aria-current={active}
      className={cn(
        'shrink-0 overflow-hidden rounded border bg-white',
        active ? 'border-primary ring-1 ring-primary' : 'border-border/60 hover:border-primary/40',
      )}
      style={{ width: THUMB_WIDTH + 2 }}
    >
      <span ref={holder} className="block" style={{ height: Math.floor(size.h * scale) }} />
      <span className="block py-0.5 text-center text-[10px] text-muted-foreground">{number}</span>
    </button>
  );
}
