/**
 * Slides: edits to a deck through the spec the file was rendered from.
 *
 * The browser edits `metadata.spec` and the server re-renders the real
 * `.pptx` from it (`POST office/ {spec}`), so what is saved is a file
 * PowerPoint opens normally — never an approximation the browser drew. An
 * uploaded deck without a spec is converted on first open (`POST import/`),
 * with the original kept as version 1. (Docs moved to TipTap: see
 * `TipTapEditor.tsx`.)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Copy, Play, Plus, Trash2, X,
} from 'lucide-react';

import { documentsService, type Document } from '../../api/documents';
import { apiErrorMessage } from '../../lib/apiError';
import { officeSpecOf, type DeckSpec, type Slide } from '../../lib/officeSpec';
import { toast } from '../../lib/toastStore';
import { cn } from '../../lib/utils';
import OfficePreview, { DeckSlide } from '../files/OfficePreview';
import {
  Divider, EditorError, EditorLoading, SaveStatus, StaleBanner, ToolButton, Toolbar,
} from './EditorChrome';
import { useRegisterSave } from './useSave';
import { useHistory } from '../../lib/history';
import { isEditableTarget, isRedoKey, isSaveKey, isUndoKey } from '../../lib/editorKeys';
import type { EditorProps } from './TextEditors';

// Limits mirrored from `chat/tools/office/deck.py`, so an input stops where
// the server would refuse rather than failing at save.
const DECK = { slides: 40, title: 90, subtitle: 200, bullets: 6, bullet: 160, notes: 3000, cols: 6, rows: 10, stats: 4 };

type DraftBody = { spec: unknown } | { grid: unknown };

function useSpecFile<T>(
  doc: Document,
  pick: (d: Document) => T | null,
  draftOf?: (spec: T) => DraftBody | null,
) {
  const qc = useQueryClient();
  const [specState, setSpecState] = useState<T | null>(null);
  const [parked, setParked] = useState('');
  const [full, setFull] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState(false);
  const [nonce, setNonce] = useState(0);
  const etag = useRef<string | undefined>(undefined);
  const { record, undo: undoHistory, redo: redoHistory, reset: resetHistory } = useHistory();

  useEffect(() => {
    let cancelled = false;
    documentsService
      .get(doc.id)
      .then((d) => {
        if (cancelled) return;
        const s = pick(d);
        etag.current = d.updated_at;
        setFull(d);
        setSpecState(s);
        setParked(JSON.stringify(s));
        resetHistory();
      })
      .catch((err) => !cancelled && setError(apiErrorMessage(err, 'Could not open this file.')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // A new file is a new mount; `reload` drives refetches through `nonce`,
    // and `pick`/`resetHistory` are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, nonce]);

  const spec = specState;
  const specRef = useRef<T | null>(null);
  useEffect(() => {
    specRef.current = spec;
  }, [spec]);
  // Parked, not rendered: autosave stores the state as a draft, so the bar
  // is clean once the draft lands — the bytes rebuild after quiet.
  const dirty = spec !== null && JSON.stringify(spec) !== parked;

  const setSpec = useCallback(
    (next: T | null) => {
      setSpecState((prev) => {
        if (prev === next) return prev;
        record(JSON.stringify(prev));
        return next;
      });
    },
    [record],
  );

  const undo = useCallback(() => {
    setSpecState((prev) => {
      const restored = undoHistory(JSON.stringify(prev));
      return restored === null ? prev : (JSON.parse(restored) as T);
    });
  }, [undoHistory]);

  const redo = useCallback(() => {
    setSpecState((prev) => {
      const restored = redoHistory(JSON.stringify(prev));
      return restored === null ? prev : (JSON.parse(restored) as T);
    });
  }, [redoHistory]);

  const save = useCallback(
    async (payload: unknown, guard = true): Promise<boolean> => {
      if (saving) return false;
      setSaving(true);
      try {
        const saved = await documentsService.editOffice(doc.id, { spec: payload }, guard ? etag.current : undefined);
        etag.current = saved.updated_at;
        const next = pick(saved);
        setFull(saved);
        setSpecState(next);
        setParked(JSON.stringify(next));
        setStale(false);
        qc.invalidateQueries({ queryKey: ['documents'] });
        qc.invalidateQueries({ queryKey: ['app-files'] });
        return true;
      } catch (err) {
        if ((err as { response?: { status?: number } })?.response?.status === 412) setStale(true);
        else toast.error('Could not save', apiErrorMessage(err, 'Please try again.'));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [doc.id, qc, saving, pick],
  );

  const saveDraft = useCallback(async (): Promise<boolean> => {
    const current = specRef.current;
    if (!draftOf || current === null || saving) return false;
    const body = draftOf(current);
    if (!body) return true;
    setSaving(true);
    try {
      const saved = await documentsService.saveDraft(doc.id, body, etag.current);
      etag.current = saved.updated_at;
      setParked(JSON.stringify(current));
      qc.invalidateQueries({ queryKey: ['documents'] });
      return true;
    } catch (err) {
      if ((err as { response?: { status?: number } })?.response?.status === 412) setStale(true);
      else toast.error('Could not autosave', apiErrorMessage(err, 'Please try again.'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [doc.id, draftOf, qc, saving]);

  // Autosave after a quiet pause: a draft parks the state cheaply, and the
  // bytes rebuild after quiet. The Save button is gone; this is the save.
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    if (!draftOf || !dirty || stale || loading) return;
    const t = window.setTimeout(() => void saveDraft(), 1500);
    return () => window.clearTimeout(t);
  }, [draftOf, dirty, stale, loading, spec, saveDraft]);

  // Flush the draft when the tab is hidden or closed.
  const draftRef = useRef(saveDraft);
  useEffect(() => {
    draftRef.current = saveDraft;
  });
  useEffect(() => {
    if (!draftOf) return;
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && dirtyRef.current) void draftRef.current();
    };
    const onHide = () => {
      if (dirtyRef.current) void draftRef.current();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onHide);
    };
  }, [draftOf]);

  const reload = () => {
    setLoading(true);
    setError(null);
    setStale(false);
    setNonce((n) => n + 1);
  };

  return { spec, setSpec, full, loading, error, saving, stale, dirty, save, reload, undo, redo };
}

function ReadOnlyNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="shrink-0 border-b border-border/60 bg-muted/40 px-4 py-2 text-[12.5px] text-muted-foreground">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

const NEW_SLIDES: { layout: Slide['layout']; label: string; make: () => Slide }[] = [
  { layout: 'bullets', label: 'Bullets', make: () => ({ layout: 'bullets', title: 'New slide', bullets: [{ text: 'First point', level: 0 }] }) },
  { layout: 'title', label: 'Title', make: () => ({ layout: 'title', title: 'Title', subtitle: '' }) },
  { layout: 'section', label: 'Section', make: () => ({ layout: 'section', title: 'Section', subtitle: '' }) },
  {
    layout: 'two_column', label: 'Two columns', make: () => ({
      layout: 'two_column', title: 'Compare',
      left: { heading: 'Before', bullets: [{ text: 'Point', level: 0 }] },
      right: { heading: 'After', bullets: [{ text: 'Point', level: 0 }] },
    }),
  },
  { layout: 'quote', label: 'Quote', make: () => ({ layout: 'quote', quote: 'A memorable line.', attribution: '' }) },
  {
    layout: 'stats', label: 'Numbers', make: () => ({
      layout: 'stats', title: 'Key numbers', stats: [{ value: '42%', label: 'Growth' }, { value: '3×', label: 'Faster' }],
    }),
  },
  {
    layout: 'table', label: 'Table', make: () => ({
      layout: 'table', title: 'Table', columns: ['Item', 'Value'], rows: [['A', '1'], ['B', '2']],
    }),
  },
  { layout: 'closing', label: 'Closing', make: () => ({ layout: 'closing', title: 'Thank you', subtitle: '' }) },
];

// Module-level so `useSpecFile` gets a stable function and its effect runs once per file.
function pickDeck(d: Document): DeckSpec | null {
  const s = officeSpecOf(d.metadata);
  return s?.kind === 'deck' ? s : null;
}

/** The draft body for a deck: the full spec, validated again at render. */
function deckDraft(s: DeckSpec): DraftBody {
  return { spec: { title: s.title, theme: s.theme?.name, slides: s.slides } };
}

/**
 * Container keys for the spec editors: save fully, or step the session
 * history. Undo/redo skip text fields, where the field's own stack owns the
 * keystroke — otherwise one Ctrl+Z would fight native undo.
 */
function specKeys(
  e: React.KeyboardEvent,
  save: () => void,
  undo: () => void,
  redo: () => void,
) {
  if (isSaveKey(e)) {
    e.preventDefault();
    save();
  } else if (!isEditableTarget(e.target) && isUndoKey(e)) {
    e.preventDefault();
    undo();
  } else if (!isEditableTarget(e.target) && isRedoKey(e)) {
    e.preventDefault();
    redo();
  }
}

/** Theme names from `chat/tools/office/themes.py::THEME_NAMES`. */
const DECK_THEMES = ['clean', 'bold', 'dark'];

export function SlidesEditor({ doc, onDirtyChange }: EditorProps) {
  const file = useSpecFile<DeckSpec>(doc, pickDeck, deckDraft);
  const [index, setIndex] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [importFailed, setImportFailed] = useState<string | null>(null);
  useEffect(() => onDirtyChange?.(file.dirty), [file.dirty, onDirtyChange]);
  // The app bar and the unsaved-changes dialog save through this.
  useRegisterSave(
    file.spec
      ? () => file.save({ title: file.spec!.title, theme: file.spec!.theme?.name, slides: file.spec!.slides }, true)
      : null,
    file.dirty,
    file.saving,
  );

  // First open of an upload converts it to an editable deck; the original
  // stays version 1. Runs once: after it, either there is a spec or a reason.
  // The state write below is the intentional mount-once trigger.
  useEffect(() => {
    if (file.loading || file.error || file.spec || importing || importFailed) return;
    let cancelled = false;
    let converted = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImporting(true);
    documentsService
      .importDoc(doc.id)
      .then((r) => {
        converted = true;
        if (!cancelled && r.warnings?.length) {
          toast.success('Converted to an editable deck', r.warnings.join(' '));
        }
      })
      .catch((err) => {
        if (!cancelled) setImportFailed(apiErrorMessage(err, 'Could not convert this deck here.'));
      })
      .finally(() => {
        if (cancelled) return;
        setImporting(false);
        if (converted) file.reload();
      });
    return () => {
      cancelled = true;
    };
    // `file.reload` is stable; `importFailed` guards the retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, file.loading, file.error, file.spec, importing, importFailed]);

  if (file.loading || importing) {
    return <EditorLoading label={importing ? 'Converting to an editable deck…' : undefined} />;
  }
  if (file.error) return <EditorError message={file.error} />;
  if (!file.spec) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ReadOnlyNotice>
          <span className="mr-2">{importFailed ?? 'This deck opens read-only here.'}</span>
          <span>Download it to edit it in PowerPoint.</span>
        </ReadOnlyNotice>
        {file.full && <OfficePreview doc={file.full} className="flex-1" />}
      </div>
    );
  }

  const spec = file.spec;
  const current = Math.min(index, spec.slides.length - 1);
  const slide = spec.slides[current];
  const setSlides = (slides: Slide[]) => file.setSpec({ ...spec, slides });
  const patchSlide = (change: Partial<Slide>) =>
    setSlides(spec.slides.map((s, i) => (i === current ? { ...s, ...change } : s)));
  const moveSlide = (from: number, to: number) => {
    if (to < 0 || to >= spec.slides.length) return;
    const next = [...spec.slides];
    const [s] = next.splice(from, 1);
    next.splice(to, 0, s);
    setSlides(next);
    setIndex(to);
  };
  const addSlide = (make: () => Slide) => {
    if (spec.slides.length >= DECK.slides) return toast.error(`A deck can hold ${DECK.slides} slides.`);
    const next = [...spec.slides];
    next.splice(current + 1, 0, make());
    setSlides(next);
    setIndex(current + 1);
    setAddOpen(false);
  };
  const save = (guard = true) =>
    void file.save({ title: spec.title, theme: spec.theme?.name, slides: spec.slides }, guard);

  const changeLayout = (layout: Slide['layout']) => {
    if (layout === slide.layout) {
      setLayoutOpen(false);
      return;
    }
    const fresh = NEW_SLIDES.find((n) => n.layout === layout)!.make();
    patchSlide({ ...fresh, layout, title: slide.title || fresh.title, notes: slide.notes });
    setLayoutOpen(false);
  };

  const changeTheme = (name: string) => {
    file.setSpec({ ...spec, theme: { ...spec.theme, name } });
    setThemeOpen(false);
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(e) => specKeys(e, save, file.undo, file.redo)}
    >
      {file.stale && <StaleBanner onReload={file.reload} onOverwrite={() => save(false)} />}
      <Toolbar>
        <div className="relative">
          <ToolButton onClick={() => setAddOpen((o) => !o)} title="New slide">
            <Plus className="h-4 w-4" /> New slide
          </ToolButton>
          {addOpen && (
            <div className="absolute left-0 top-full z-30 mt-1 w-44 rounded-md border border-border/60 bg-popover p-1 shadow-lg">
              {NEW_SLIDES.map((n) => (
                <button
                  key={n.layout}
                  type="button"
                  onClick={() => addSlide(n.make)}
                  className="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-muted"
                >
                  {n.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <ToolButton onClick={() => setLayoutOpen((o) => !o)} title="Change this slide's layout">
            Layout
          </ToolButton>
          {layoutOpen && (
            <div className="absolute left-0 top-full z-30 mt-1 w-44 rounded-md border border-border/60 bg-popover p-1 shadow-lg">
              {NEW_SLIDES.map((n) => (
                <button
                  key={n.layout}
                  type="button"
                  onClick={() => changeLayout(n.layout)}
                  aria-current={n.layout === slide.layout}
                  className={cn(
                    'block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-muted',
                    n.layout === slide.layout && 'font-medium text-primary',
                  )}
                >
                  {n.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <ToolButton onClick={() => setThemeOpen((o) => !o)} title="Change the deck's theme">
            Theme
          </ToolButton>
          {themeOpen && (
            <div className="absolute left-0 top-full z-30 mt-1 w-44 rounded-md border border-border/60 bg-popover p-1 shadow-lg">
              {DECK_THEMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => changeTheme(name)}
                  aria-current={name === spec.theme?.name}
                  className={cn(
                    'block w-full rounded px-2 py-1.5 text-left text-[13px] capitalize hover:bg-muted',
                    name === spec.theme?.name && 'font-medium text-primary',
                  )}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
        <ToolButton onClick={() => addSlide(() => structuredClone(slide))} title="Duplicate slide">
          <Copy className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          onClick={() => {
            if (spec.slides.length <= 1) return;
            setSlides(spec.slides.filter((_, i) => i !== current));
            setIndex(Math.max(0, current - 1));
          }}
          disabled={spec.slides.length <= 1}
          title="Delete slide"
        >
          <Trash2 className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => moveSlide(current, current - 1)} disabled={current === 0} title="Move up">
          <ArrowUp className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => moveSlide(current, current + 1)} disabled={current === spec.slides.length - 1} title="Move down">
          <ArrowDown className="h-4 w-4" />
        </ToolButton>
        <Divider />
        <input
          value={spec.title}
          onChange={(e) => file.setSpec({ ...spec, title: e.target.value.slice(0, DECK.title) })}
          aria-label="Deck title"
          placeholder="Deck title"
          className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-[13px] font-medium outline-none hover:border-border/60 focus:border-primary"
        />
        <ToolButton onClick={() => setPresenting(true)} title="Present">
          <Play className="h-4 w-4" /> Present
        </ToolButton>
      </Toolbar>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Slide rail: a strip on phones, a column from md up. Drag to reorder. */}
        <ol className="m-0 flex shrink-0 list-none gap-2 overflow-auto border-b border-border/60 bg-muted/30 p-2 md:w-44 md:flex-col md:border-b-0 md:border-r">
          {spec.slides.map((_, i) => (
            <li
              key={i}
              className="w-28 shrink-0 md:w-full"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                setDragFrom(i);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragFrom !== null && dragFrom !== i) {
                  moveSlide(dragFrom, i);
                  setIndex(i);
                }
                setDragFrom(null);
              }}
              onDragEnd={() => setDragFrom(null)}
            >
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-current={i === current}
                aria-label={`Slide ${i + 1}`}
                className={cn(
                  'flex w-full cursor-grab items-start gap-1.5 rounded-md p-1 text-left active:cursor-grabbing',
                  i === current ? 'bg-primary/15 ring-2 ring-primary' : 'hover:bg-muted',
                  dragFrom === i && 'opacity-50',
                )}
              >
                <span className="w-4 shrink-0 pt-0.5 text-right text-[10px] text-muted-foreground">{i + 1}</span>
                <div className="pointer-events-none min-w-0 flex-1">
                  <DeckSlide spec={spec} index={i} className="shadow-none" />
                </div>
              </button>
            </li>
          ))}
        </ol>

        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto max-w-3xl space-y-4 p-4">
            <DeckSlide spec={spec} index={current} edit={{ patch: patchSlide }} />
            <textarea
              value={slide.notes ?? ''}
              onChange={(e) => patchSlide({ notes: e.target.value || undefined })}
              placeholder="Speaker notes — what you will say on this slide…"
              aria-label="Speaker notes"
              maxLength={DECK.notes}
              rows={2}
              className="w-full resize-y rounded-lg border border-border/60 bg-card px-3 py-2 text-[13px] outline-none focus:border-primary"
            />
            <SlideFields key={current} slide={slide} onChange={patchSlide} />
          </div>
        </div>
      </div>

      <SaveStatus
        dirty={file.dirty}
        saving={file.saving}
        hint="Autosaves as you type"
        extra={<span>Slide {current + 1} of {spec.slides.length} · {spec.theme?.name} theme</span>}
      />

      {presenting && <Presenter spec={spec} start={current} onClose={() => setPresenting(false)} />}
    </div>
  );
}

const inputCls = 'w-full rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary';

function SlideFields({ slide, onChange }: { slide: Slide; onChange: (c: Partial<Slide>) => void }) {
  // Text lives on the slide itself (DeckSlide edit mode); this keeps
  // structure: stat rows, the table grid, and the notes the chart and image
  // layouts cannot hold on-slide.
  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-card p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{slide.layout.replace('_', ' ')} slide</p>
      {slide.layout === 'stats' && (
        <div className="space-y-2">
          {(slide.stats ?? []).map((st, i) => (
            <div key={i} className="flex items-center gap-2 text-[13px]">
              <span className="min-w-0 flex-1 truncate font-medium">{st.value || '—'}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{st.label || '—'}</span>
              <button type="button" aria-label="Remove" className="rounded p-1.5 text-muted-foreground hover:text-destructive"
                onClick={() => onChange({ stats: slide.stats!.filter((_, j) => j !== i) })}>
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          {(slide.stats?.length ?? 0) < DECK.stats && (
            <button type="button" className="text-[12.5px] text-primary hover:underline"
              onClick={() => onChange({ stats: [...(slide.stats ?? []), { value: '0', label: 'Label' }] })}>
              + Add number
            </button>
          )}
        </div>
      )}
      {slide.layout === 'table' && (
        <TableBox
          columns={slide.columns ?? []}
          rows={slide.rows ?? []}
          maxCols={DECK.cols}
          maxRows={DECK.rows}
          onChange={(columns, rows) => onChange({ columns, rows })}
        />
      )}
      {(slide.layout === 'chart' || slide.layout === 'image') && (
        <p className="text-[12px] text-muted-foreground">
          The {slide.layout} itself is kept as it is — edit the caption on the slide, or ask the
          assistant to change its data.
        </p>
      )}
    </div>
  );
}

function TableBox({
  columns, rows, maxCols, maxRows, onChange,
}: {
  columns: string[];
  rows: string[][];
  maxCols: number;
  maxRows: number;
  onChange: (columns: string[], rows: string[][]) => void;
}) {
  const width = columns.length;
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="border-collapse text-[13px]">
          <thead>
            <tr>
              {columns.map((c, j) => (
                <th key={j} className="p-0.5">
                  <input className={cn(inputCls, 'min-w-24 font-semibold')} value={c} aria-label={`Column ${j + 1}`}
                    onChange={(e) => onChange(columns.map((x, k) => (k === j ? e.target.value : x)), rows)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {Array.from({ length: width }, (_, j) => (
                  <td key={j} className="p-0.5">
                    <input className={cn(inputCls, 'min-w-24')} value={row[j] ?? ''} aria-label={`Row ${i + 1}, column ${j + 1}`}
                      onChange={(e) => onChange(columns, rows.map((r, k) => (k === i ? Array.from({ length: width }, (_, m) => (m === j ? e.target.value : r[m] ?? '')) : r)))} />
                  </td>
                ))}
                <td className="p-0.5">
                  <button type="button" aria-label="Remove row" className="rounded p-1 text-muted-foreground hover:text-destructive"
                    onClick={() => onChange(columns, rows.filter((_, k) => k !== i))}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-3 text-[12.5px]">
        {rows.length < maxRows && (
          <button type="button" className="text-primary hover:underline" onClick={() => onChange(columns, [...rows, Array(width).fill('')])}>
            + Row
          </button>
        )}
        {width < maxCols && (
          <button type="button" className="text-primary hover:underline"
            onClick={() => onChange([...columns, `Column ${width + 1}`], rows.map((r) => [...r, '']))}>
            + Column
          </button>
        )}
        {width > 1 && (
          <button type="button" className="text-muted-foreground hover:text-destructive hover:underline"
            onClick={() => onChange(columns.slice(0, -1), rows.map((r) => r.slice(0, width - 1)))}>
            − Last column
          </button>
        )}
      </div>
    </div>
  );
}

function Presenter({ spec, start, onClose }: { spec: DeckSpec; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  // Measured from the stage itself: a viewport calc guesses the chrome above
  // it (and guesses wrong on phones, where the chrome moves).
  const [fitWidth, setFitWidth] = useState<number | null>(null);
  useEffect(() => {
    box.current?.requestFullscreen?.().catch(() => undefined);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (['ArrowRight', 'ArrowDown', ' ', 'PageDown'].includes(e.key)) setI((n) => Math.min(n + 1, spec.slides.length - 1));
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [onClose, spec.slides.length]);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setFitWidth(Math.max(0, Math.min(rect.width, (rect.height * 16) / 9)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={box} className="fixed inset-0 z-[150] flex flex-col bg-black" role="dialog" aria-label="Presentation">
      <div ref={stage} className="flex min-h-0 flex-1 items-center justify-center p-2 sm:p-6" onClick={() => setI((n) => Math.min(n + 1, spec.slides.length - 1))}>
        <div className="w-full" style={fitWidth ? { width: fitWidth } : undefined}>
          <DeckSlide spec={spec} index={i} className="border-none" />
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-center gap-4 pb-4 text-sm text-white/70">
        <button type="button" aria-label="Previous slide" onClick={() => setI((n) => Math.max(n - 1, 0))} className="rounded p-2 hover:bg-white/10">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span>{i + 1} / {spec.slides.length}</span>
        <button type="button" aria-label="Next slide" onClick={() => setI((n) => Math.min(n + 1, spec.slides.length - 1))} className="rounded p-2 hover:bg-white/10">
          <ChevronRight className="h-5 w-5" />
        </button>
        <button type="button" onClick={onClose} className="ml-4 rounded px-3 py-1.5 hover:bg-white/10">Exit (Esc)</button>
      </div>
    </div>
  );
}
