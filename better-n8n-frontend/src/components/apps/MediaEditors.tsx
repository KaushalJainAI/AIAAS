/**
 * The viewing apps — PDF Reader, Photos, Media Player — and Whiteboard, the
 * one of them that makes a file.
 *
 * Every byte comes through `hooks/useBlobUrl`, which explains why a `blob:`
 * URL and not the API address.
 */
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, Circle, Download, Eraser, Highlighter, Loader2, Maximize2, Minus as LineIcon,
  Pencil, PenTool, RotateCcw, RotateCw, Save, Square, Trash2, Undo2, ZoomIn, ZoomOut,
} from 'lucide-react';

import { documentsService, type Document } from '../../api/documents';
import { useBlobUrl, usePreviewImageUrl } from '../../hooks/useBlobUrl';
import { apiErrorMessage } from '../../lib/apiError';
import { toast } from '../../lib/toastStore';
import { cn } from '../../lib/utils';
import { Divider, EditorError, EditorLoading, ToolButton, Toolbar } from './EditorChrome';

function Chrome({ children, doc, extra }: { children: React.ReactNode; doc: Document; extra?: React.ReactNode }) {
  const download = async () => {
    try {
      const blob = await documentsService.download(doc.id);
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u;
      a.download = doc.filename;
      a.click();
      URL.revokeObjectURL(u);
    } catch (err) {
      toast.error('Download failed', apiErrorMessage(err, 'Please try again.'));
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {children}
      <div className="flex shrink-0 items-center gap-3 border-t border-border/60 bg-card px-3 py-1.5 text-[11.5px] text-muted-foreground">
        <span className="truncate">{doc.filename}</span>
        <span className="ml-auto flex items-center gap-3">{extra}</span>
        <button type="button" onClick={() => void download()} className="inline-flex items-center gap-1 hover:text-foreground">
          <Download className="h-3.5 w-3.5" /> Download
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PDF Reader
// ---------------------------------------------------------------------------

const PdfJsViewer = lazy(() => import('../files/PdfJsViewer'));

export function PdfViewer({ doc }: { doc: Document }) {
  return (
    <Chrome doc={doc}>
      {/* pdf.js, not the browser's viewer: the same pages on every device,
          phones included. */}
      <Suspense fallback={<EditorLoading label="Opening…" />}>
        <PdfJsViewer docId={doc.id} />
      </Suspense>
    </Chrome>
  );
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/** Extensions most browsers cannot display, converted server-side to PNG. */
function needsConversion(filename: string): boolean {
  const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
  return ext === 'tif' || ext === 'tiff' || ext === 'bmp' || ext === 'heic' || ext === 'heif';
}

export function PhotosViewer({
  doc, siblings = [], onOpenDoc,
}: { doc: Document; siblings?: Document[]; onOpenDoc?: (d: Document) => void }) {
  const navigate = useNavigate();
  const converted = needsConversion(doc.filename);
  const direct = useBlobUrl(converted ? null : doc.id);
  const rendered = usePreviewImageUrl(converted ? doc.id : null);
  const { url, error } = converted ? rendered : direct;
  const [zoom, setZoom] = useState(1);
  const [rotate, setRotate] = useState(0);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const at = siblings.findIndex((s) => s.id === doc.id);
  const prev = at > 0 ? siblings[at - 1] : null;
  const next = at >= 0 && at < siblings.length - 1 ? siblings[at + 1] : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'ArrowLeft' && prev) onOpenDoc?.(prev);
      else if (e.key === 'ArrowRight' && next) onOpenDoc?.(next);
      else if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(z * 1.25, 8));
      else if (e.key === '-') setZoom((z) => Math.max(z / 1.25, 0.1));
      else if (e.key === '0') setZoom(1);
      else if (e.key.toLowerCase() === 'r') setRotate((r) => (r + 90) % 360);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, onOpenDoc]);

  if (error) return <EditorError message={error} />;
  return (
    <Chrome
      doc={doc}
      extra={
        <>
          {size && <span>{size.w} × {size.h}</span>}
          {siblings.length > 1 && at >= 0 && <span>{at + 1} of {siblings.length}</span>}
          <span>{Math.round(zoom * 100)}%</span>
        </>
      }
    >
      <Toolbar>
        <ToolButton onClick={() => prev && onOpenDoc?.(prev)} disabled={!prev} title="Previous (←)"><ChevronLeft className="h-4 w-4" /></ToolButton>
        <ToolButton onClick={() => next && onOpenDoc?.(next)} disabled={!next} title="Next (→)"><ChevronRight className="h-4 w-4" /></ToolButton>
        <Divider />
        <ToolButton onClick={() => setZoom((z) => Math.max(z / 1.25, 0.1))} title="Zoom out (−)"><ZoomOut className="h-4 w-4" /></ToolButton>
        <ToolButton onClick={() => setZoom(1)} title="Fit (0)"><Maximize2 className="h-4 w-4" /></ToolButton>
        <ToolButton onClick={() => setZoom((z) => Math.min(z * 1.25, 8))} title="Zoom in (+)"><ZoomIn className="h-4 w-4" /></ToolButton>
        <Divider />
        <ToolButton onClick={() => setRotate((r) => (r + 270) % 360)} title="Rotate left"><RotateCcw className="h-4 w-4" /></ToolButton>
        <ToolButton onClick={() => setRotate((r) => (r + 90) % 360)} title="Rotate right (R)"><RotateCw className="h-4 w-4" /></ToolButton>
        <Divider />
        <ToolButton onClick={() => navigate(`/apps/whiteboard?file=${doc.id}`)} title="Draw on this image">
          <PenTool className="h-4 w-4" /> <span className="hidden sm:inline">Draw on it</span>
        </ToolButton>
      </Toolbar>
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[repeating-conic-gradient(hsl(var(--muted))_0_25%,transparent_0_50%)] bg-[length:20px_20px]"
        onWheel={(e) => {
          if (!e.ctrlKey) return;
          e.preventDefault();
          setZoom((z) => Math.min(Math.max(z * (e.deltaY < 0 ? 1.1 : 0.9), 0.1), 8));
        }}
      >
        {!url ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <img
            src={url}
            alt={doc.title || doc.filename}
            onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            style={{ transform: `rotate(${rotate}deg) scale(${zoom})`, transition: 'transform 120ms ease' }}
            className="max-h-full max-w-full object-contain"
            draggable={false}
          />
        )}
      </div>
    </Chrome>
  );
}

// ---------------------------------------------------------------------------
// Media Player
// ---------------------------------------------------------------------------

export function MediaPlayer({ doc }: { doc: Document }) {
  const { url, error } = useBlobUrl(doc.id);
  // Fresh mount per file (callers key on the document id), so the initial
  // state is the reset.
  const [unplayable, setUnplayable] = useState(false);
  if (error) return <EditorError message={error} />;
  if (!url) return <EditorLoading />;
  // Converting media server-side is too heavy for the box, so a format the
  // browser cannot play says so instead of sitting black or silent.
  if (unplayable) {
    return (
      <Chrome doc={doc}>
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <p className="max-w-sm rounded-lg border border-border/60 bg-card px-4 py-3 text-center text-[13px] text-muted-foreground">
            This format doesn&apos;t play in the browser. Download it to watch.
          </p>
        </div>
      </Chrome>
    );
  }
  return (
    <Chrome doc={doc}>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black/90 p-4">
        {doc.file_type === 'audio' ? (
          <div className="w-full max-w-lg rounded-xl bg-card p-6 text-center shadow-lg">
            <p className="mb-4 truncate text-sm font-medium">{doc.filename}</p>
            <audio src={url} controls autoPlay className="w-full" onError={() => setUnplayable(true)} />
          </div>
        ) : (
          <video src={url} controls autoPlay className="max-h-full max-w-full rounded-md" onError={() => setUnplayable(true)} />
        )}
      </div>
    </Chrome>
  );
}

// ---------------------------------------------------------------------------
// Whiteboard
// ---------------------------------------------------------------------------

type Tool = 'pen' | 'highlighter' | 'eraser' | 'line' | 'rect' | 'ellipse';
interface Stroke {
  tool: Tool;
  color: string;
  size: number;
  points: { x: number; y: number }[];
}

const COLORS = ['#111827', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#2563eb', '#7c3aed', '#ffffff'];
const SIZES = [2, 4, 8, 16];
const BOARD = { w: 1600, h: 1000 };
const MAX_SIDE = 2400;

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  if (!s.points.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = s.tool === 'highlighter' ? s.size * 3 : s.tool === 'eraser' ? s.size * 3 : s.size;
  ctx.strokeStyle = s.color;
  ctx.globalAlpha = s.tool === 'highlighter' ? 0.35 : 1;
  ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
  const first = s.points[0];
  const last = s.points[s.points.length - 1];
  ctx.beginPath();
  if (s.tool === 'line') {
    ctx.moveTo(first.x, first.y);
    ctx.lineTo(last.x, last.y);
  } else if (s.tool === 'rect') {
    ctx.rect(first.x, first.y, last.x - first.x, last.y - first.y);
  } else if (s.tool === 'ellipse') {
    ctx.ellipse((first.x + last.x) / 2, (first.y + last.y) / 2, Math.abs(last.x - first.x) / 2, Math.abs(last.y - first.y) / 2, 0, 0, Math.PI * 2);
  } else {
    ctx.moveTo(first.x, first.y);
    for (const p of s.points.slice(1)) ctx.lineTo(p.x, p.y);
    if (s.points.length === 1) ctx.lineTo(first.x + 0.01, first.y);
  }
  ctx.stroke();
  ctx.restore();
}

export function Whiteboard({ doc, onCreated }: { doc: Document | null; onCreated?: (d: Document) => void }) {
  const qc = useQueryClient();
  const { url, error } = useBlobUrl(doc?.id ?? null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [board, setBoard] = useState(BOARD);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[1]);
  const [size, setSize] = useState(4);
  const [saving, setSaving] = useState(false);
  const bg = useRef<HTMLCanvasElement>(null);
  const ink = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<Stroke | null>(null);

  // Load the image being annotated; the board takes its size (capped).
  // The editor is keyed on the file, so a different image is a fresh mount
  // and nothing here needs resetting — only the image has to arrive.
  const docId = doc?.id ?? null;
  useEffect(() => {
    if (docId === null || !url) return;
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      setBoard({ w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) });
      setImage(img);
    };
    img.src = url;
  }, [docId, url]);

  useEffect(() => {
    const ctx = bg.current?.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, board.w, board.h);
    if (image) ctx.drawImage(image, 0, 0, board.w, board.h);
  }, [image, board]);

  const redraw = useCallback((extra?: Stroke | null) => {
    const ctx = ink.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, board.w, board.h);
    for (const s of strokes) drawStroke(ctx, s);
    if (extra) drawStroke(ctx, extra);
  }, [strokes, board]);

  useEffect(() => redraw(), [redraw]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        setStrokes((s) => s.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * board.w, y: ((e.clientY - rect.top) / rect.height) * board.h };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = { tool, color, size, points: [point(e)] };
    redraw(drawing.current);
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = drawing.current;
    if (!s) return;
    const p = point(e);
    if (s.tool === 'line' || s.tool === 'rect' || s.tool === 'ellipse') s.points = [s.points[0], p];
    else s.points.push(p);
    redraw(s);
  };
  const onUp = () => {
    const s = drawing.current;
    drawing.current = null;
    if (s) setStrokes((prev) => [...prev, s]);
  };

  const save = async () => {
    if (!bg.current || !ink.current) return;
    setSaving(true);
    try {
      const out = document.createElement('canvas');
      out.width = board.w;
      out.height = board.h;
      const ctx = out.getContext('2d')!;
      ctx.drawImage(bg.current, 0, 0);
      ctx.drawImage(ink.current, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('The drawing could not be exported.');
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
      const name = doc ? `${doc.filename.replace(/\.[^.]+$/, '')} (annotated).png` : `Sketch ${stamp}.png`;
      const created = await documentsService.upload(new File([blob], name, { type: 'image/png' }), doc?.folder_id ?? null);
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['app-files'] });
      toast.success('Saved as a new image', created.filename);
      onCreated?.(created);
    } catch (err) {
      toast.error('Could not save', apiErrorMessage(err, 'Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  if (doc && error) return <EditorError message={error} />;
  if (doc && !image) return <EditorLoading label="Loading image…" />;

  const tools: [Tool, typeof Pencil, string][] = [
    ['pen', Pencil, 'Pen'],
    ['highlighter', Highlighter, 'Highlighter'],
    ['eraser', Eraser, 'Eraser'],
    ['line', LineIcon, 'Line'],
    ['rect', Square, 'Rectangle'],
    ['ellipse', Circle, 'Ellipse'],
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar>
        {tools.map(([t, Icon, label]) => (
          <ToolButton key={t} onClick={() => setTool(t)} active={tool === t} title={label}>
            <Icon className="h-4 w-4" />
          </ToolButton>
        ))}
        <Divider />
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            aria-label={`Colour ${c}`}
            aria-pressed={color === c}
            className={cn('h-6 w-6 rounded-full border border-border/70', color === c && 'ring-2 ring-primary ring-offset-1 ring-offset-card')}
            style={{ background: c }}
          />
        ))}
        <Divider />
        {SIZES.map((s) => (
          <ToolButton key={s} onClick={() => setSize(s)} active={size === s} title={`Size ${s}`}>
            <span className="rounded-full bg-current" style={{ width: Math.min(s + 2, 14), height: Math.min(s + 2, 14) }} />
          </ToolButton>
        ))}
        <Divider />
        <ToolButton onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={!strokes.length} title="Undo (Ctrl+Z)">
          <Undo2 className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => setStrokes([])} disabled={!strokes.length} title="Clear drawing">
          <Trash2 className="h-4 w-4" />
        </ToolButton>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || (!strokes.length && !doc)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save as PNG
        </button>
      </Toolbar>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/50 p-3">
        <div className="relative w-full max-w-full shadow-md" style={{ aspectRatio: `${board.w} / ${board.h}`, maxHeight: '100%', maxWidth: `calc((100dvh - 14rem) * ${board.w / board.h})` }}>
          <canvas ref={bg} width={board.w} height={board.h} className="absolute inset-0 h-full w-full rounded-sm" />
          <canvas
            ref={ink}
            width={board.w}
            height={board.h}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            className="absolute inset-0 h-full w-full cursor-crosshair touch-none rounded-sm"
            aria-label="Drawing surface"
          />
        </div>
      </div>
      <div className="shrink-0 border-t border-border/60 bg-card px-3 py-1.5 text-[11.5px] text-muted-foreground">
        {doc ? `Drawing on ${doc.filename} — saving makes a new image, the original is untouched.` : 'A blank board. Saving adds a PNG to your files.'}
      </div>
    </div>
  );
}
