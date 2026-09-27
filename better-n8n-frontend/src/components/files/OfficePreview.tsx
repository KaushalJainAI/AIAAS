/**
 * Previews of the files the office tools render — decks, workbooks, documents.
 *
 * Drawn from the spec stored beside the file (`lib/officeSpec.ts`), never from
 * the bytes: a browser cannot lay out a `.pptx`, and a server-side renderer
 * (LibreOffice) would cost more memory than this box has. So the preview is a
 * faithful *reading* of the file — same slides, same words, same theme colours
 * — and says plainly that it is a preview; the download is the real thing.
 *
 * Colours inside a slide come from the deck's own theme, not from the app's
 * tokens, on purpose: this shows what the file looks like, and a dark deck
 * previewed in light mode must still look dark.
 *
 * Every stored string is rendered as text (`spans`), never as HTML: a spec is
 * model-authored and may quote a web page.
 */

import { Suspense, lazy, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ImageIcon, Loader2 } from 'lucide-react';
import type { IWorkbookData } from '@univerjs/core';

import { documentsService, type Document, type WorkbookGrid } from '../../api/documents';
import ChartArtifact from '../chat/ChartArtifact';
import {
  formatCell,
  hex,
  officeSpecOf,
  sheetChart,
  spans,
  type Bullet,
  type DeckSpec,
  type DocumentSpec,
  type Slide,
  type WorkbookSpec,
} from '../../lib/officeSpec';
import { cn } from '../../lib/utils';

export default function OfficePreview({ doc: given, className }: { doc: Document; className?: string }) {
  // A listing leaves out the spec and the extracted text (both can be large),
  // so a document that arrived from one is re-read in full before drawing.
  const complete = officeSpecOf(given.metadata) !== null || given.content !== undefined;
  const [fetched, setFetched] = useState<Document | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (complete) return;
    let cancelled = false;
    documentsService
      .get(given.id)
      .then((d) => { if (!cancelled) setFetched(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [complete, given.id]);

  const doc = complete ? given : fetched;
  if (!doc) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        {failed ? 'This file could not be read.' : (<><Loader2 className="h-4 w-4 animate-spin" /> Loading…</>)}
      </div>
    );
  }
  const spec = officeSpecOf(doc.metadata);

  if (!spec && doc.file_type === 'xlsx') {
    // A workbook with no spec (uploaded, or edited cell by cell since it was
    // rendered) is read from its real cells rather than from the extract.
    return <LiveWorkbookPreview doc={doc} className={className} />;
  }

  if (!spec) {
    // An uploaded Office file: no spec, but the extractor kept its text.
    const text = doc.content?.trim();
    return (
      <div className={cn('p-4', className)}>
        <p className="mb-3 text-xs text-muted-foreground">
          Text extracted from this file. Use Export to take the original layout with you.
        </p>
        {text ? (
          <pre className="m-0 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground/90">
            {text}
          </pre>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">No preview is available for this file.</p>
        )}
      </div>
    );
  }

  return (
    <div className={cn('min-h-0 overflow-auto', className)}>
      {spec.kind === 'deck' && <DeckPreview spec={spec} />}
      {spec.kind === 'workbook' && <WorkbookPreview spec={spec} />}
      {spec.kind === 'document' && <DocumentPreview spec={spec} docId={doc.id} />}
    </div>
  );
}

function Rich({ text, italic }: { text: string; italic?: boolean }) {
  return (
    <>
      {spans(text, { italic }).map((s, i) =>
        s.bold ? <strong key={i}>{s.text}</strong> : s.italic ? <em key={i}>{s.text}</em> : <span key={i}>{s.text}</span>,
      )}
    </>
  );
}



// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

/** Sizes are in container-width units, so a slide scales as one picture. */
const cq = (n: number): CSSProperties => ({ fontSize: `${n}cqw`, lineHeight: 1.2 });

/** A deck theme's colours, with safe fallbacks for a spec that lacks one. */
function deckColors(t: DeckSpec['theme']): Colors {
  return {
    bg: hex(t?.background, '#ffffff'),
    surface: hex(t?.surface, '#f3f5f8'),
    text: hex(t?.text, '#1a1a1a'),
    muted: hex(t?.muted, '#5f6368'),
    accent: hex(t?.accent, '#2a78d6'),
    onAccent: hex(t?.on_accent, '#ffffff'),
    rule: hex(t?.rule, '#d9dde3'),
  };
}

/** One slide drawn at 16:9, scaling as a single picture. Shared with the Slides app. */
export function DeckSlide({ spec, index, className, edit }: {
  spec: DeckSpec;
  index: number;
  className?: string;
  /** When set, text is edited directly on the slide instead of in a form. */
  edit?: SlideEdit;
}) {
  const colors = deckColors(spec.theme);
  const slide = spec.slides[index];
  if (!slide) return null;
  return (
    <div
      className={cn(
        'relative aspect-[16/9] w-full overflow-hidden rounded-md border border-border/60 shadow-sm [container-type:inline-size]',
        className,
      )}
      style={{ background: colors.bg, color: colors.text }}
    >
      <SlideBody slide={slide} c={colors} accentTitle={!!spec.theme?.accent_title} edit={edit} />
      {slide.layout !== 'title' && (
        <span className="absolute bottom-[3%] right-[5%]" style={{ ...cq(1.1), color: colors.muted }}>
          {index + 1}
        </span>
      )}
    </div>
  );
}

/** On-slide editing: text fields placed over the slide, in its own type. */
export interface SlideEdit {
  patch: (change: Partial<Slide>) => void;
}

/** A transparent input in the slide's own type — the text *is* the field. */
function EditText({
  value, onChange, placeholder, multiline, className, ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const cls = cn(
    'w-full bg-transparent outline-none [color:inherit] [font:inherit] placeholder:opacity-50',
    'rounded-sm focus-visible:ring-1 focus-visible:ring-primary/50',
    className,
  );
  if (multiline) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        rows={1}
        className={cn(cls, 'resize-none overflow-hidden')}
        onInput={(e) => {
          const el = e.currentTarget;
          el.style.height = 'auto';
          el.style.height = `${el.scrollHeight}px`;
        }}
      />
    );
  }
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      className={cls}
    />
  );
}

function DeckPreview({ spec }: { spec: DeckSpec }) {
  const t = spec.theme;
  const [index, setIndex] = useState(0);
  const current = Math.min(index, spec.slides.length - 1);
  const slide = spec.slides[current];
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={current === 0}
          aria-label="Previous slide"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-16 text-center text-xs text-muted-foreground">
          {current + 1} / {spec.slides.length}
        </span>
        <button
          type="button"
          onClick={() => setIndex((i) => Math.min(spec.slides.length - 1, i + 1))}
          disabled={current >= spec.slides.length - 1}
          aria-label="Next slide"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <p className="ml-2 truncate text-xs text-muted-foreground">
          {t.name} theme · in-browser preview — Export for the PowerPoint file, where charts stay editable.
        </p>
      </div>
      {slide && (
        <figure key={current} className="m-0">
          <DeckSlide spec={spec} index={current} />
          {slide.notes && (
            <figcaption className="mt-1.5 px-1 text-[11px] text-muted-foreground">
              <span className="font-medium">Notes:</span> {slide.notes}
            </figcaption>
          )}
        </figure>
      )}
    </div>
  );
}

type Colors = {
  bg: string; surface: string; text: string; muted: string;
  accent: string; onAccent: string; rule: string;
};

function SlideTitle({ title, c, accentTitle, edit }: {
  title?: string;
  c: Colors;
  accentTitle: boolean;
  edit?: SlideEdit;
}) {
  return (
    <>
      {accentTitle && <div className="absolute inset-y-0 left-0 w-[1.35%]" style={{ background: c.accent }} />}
      <div className="absolute left-[5.25%] right-[5.25%] top-[6.5%] font-bold" style={cq(2.4)}>
        {edit ? (
          <EditText value={title ?? ''} onChange={(title) => edit.patch({ title })} placeholder="Title" ariaLabel="Slide title" />
        ) : (
          title && <Rich text={title} italic={false} />
        )}
      </div>
      <div className="absolute left-[5.25%] top-[20.5%] h-[0.75%] w-[6.75%]" style={{ background: c.accent }} />
    </>
  );
}

function BulletList({ bullets, c, size, edit }: {
  bullets: Bullet[];
  c: Colors;
  size: number;
  edit?: { bullets: Bullet[]; onChange: (bullets: Bullet[]) => void };
}) {
  return (
    <ul className="m-0 list-none space-y-[0.9cqw] p-0">
      {bullets.map((b, i) => (
        <li
          key={i}
          className="flex gap-[1cqw]"
          style={{ ...cq(b.level ? size - 0.25 : size), color: b.level ? c.muted : c.text, paddingLeft: b.level ? '2.6cqw' : 0 }}
        >
          {edit ? (
            <button
              type="button"
              title={b.level ? 'Outdent' : 'Indent'}
              aria-label={b.level ? `Outdent point ${i + 1}` : `Indent point ${i + 1}`}
              onClick={() => {
                if (i === 0 && !b.level) return;
                const next = bullets.map((x, j) => (j === i ? { ...x, level: (x.level ? 0 : 1) as 0 | 1 } : x));
                edit.onChange(next);
              }}
              style={{ color: b.level ? c.muted : c.accent }}
              className="shrink-0 rounded-sm hover:opacity-70"
            >
              {b.level ? '–' : '•'}
            </button>
          ) : (
            <span style={{ color: b.level ? c.muted : c.accent }}>{b.level ? '–' : '•'}</span>
          )}
          {edit ? (
            <EditText
              value={b.text}
              onChange={(text) => {
                if (!text && bullets.length > 1) {
                  edit.onChange(bullets.filter((_, j) => j !== i));
                } else {
                  edit.onChange(bullets.map((x, j) => (j === i ? { ...x, text } : x)));
                }
              }}
              placeholder="Point"
              ariaLabel={`Point ${i + 1}`}
            />
          ) : (
            <span><Rich text={b.text} italic={false} /></span>
          )}
        </li>
      ))}
      {edit && bullets.length < 6 && (
        <li>
          <button
            type="button"
            onClick={() => edit.onChange([...bullets, { text: '', level: 0 }])}
            className="rounded-sm text-[0.9em] opacity-60 hover:opacity-100"
            style={{ color: c.muted }}
          >
            + Add point
          </button>
        </li>
      )}
    </ul>
  );
}

function Content({ children }: { children: ReactNode }) {
  return <div className="absolute bottom-[10%] left-[5.25%] right-[5.25%] top-[25%]">{children}</div>;
}

function SlideBody({ slide, c, accentTitle, edit }: {
  slide: Slide;
  c: Colors;
  accentTitle: boolean;
  edit?: SlideEdit;
}) {
  const patch = edit?.patch;
  switch (slide.layout) {
    case 'title':
    case 'closing': {
      const onAccent = accentTitle;
      return (
        <div className="absolute inset-0" style={{ background: onAccent ? c.accent : undefined }}>
          {!onAccent && <div className="absolute left-[5.25%] top-[32.7%] h-[32%] w-[1.05%]" style={{ background: c.accent }} />}
          <div className="absolute bottom-[46.7%] left-[8.6%] right-[5.25%] font-bold" style={{ ...cq(slide.layout === 'title' ? 3.6 : 3.3), color: onAccent ? c.onAccent : c.text }}>
            {patch ? (
              <EditText value={slide.title ?? ''} onChange={(title) => patch({ title })} placeholder="Title" ariaLabel="Slide title" />
            ) : slide.title}
          </div>
          {(slide.subtitle || patch) && (
            <div className="absolute left-[8.6%] right-[5.25%] top-[55.3%]" style={{ ...cq(1.65), color: onAccent ? c.onAccent : c.muted }}>
              {patch ? (
                <EditText value={slide.subtitle ?? ''} onChange={(subtitle) => patch({ subtitle })} placeholder="Subtitle" ariaLabel="Slide subtitle" />
              ) : slide.subtitle}
            </div>
          )}
        </div>
      );
    }
    case 'section':
      return (
        <>
          <div className="absolute left-[5.25%] top-[38.7%] h-[0.9%] w-[9%]" style={{ background: c.accent }} />
          <div className="absolute left-[5.25%] right-[5.25%] top-[41.3%] font-bold" style={cq(3)}>
            {patch ? (
              <EditText value={slide.title ?? ''} onChange={(title) => patch({ title })} placeholder="Section" ariaLabel="Section title" />
            ) : slide.title}
          </div>
          {(slide.subtitle || patch) && (
            <div className="absolute left-[5.25%] right-[5.25%] top-[58.7%]" style={{ ...cq(1.5), color: c.muted }}>
              {patch ? (
                <EditText value={slide.subtitle ?? ''} onChange={(subtitle) => patch({ subtitle })} placeholder="Subtitle" ariaLabel="Section subtitle" />
              ) : slide.subtitle}
            </div>
          )}
        </>
      );
    case 'bullets': {
      const n = slide.bullets?.length ?? 0;
      return (
        <>
          <SlideTitle title={slide.title} c={c} accentTitle={accentTitle} edit={edit} />
          <Content>
            <BulletList
              bullets={slide.bullets ?? []}
              c={c}
              size={n <= 3 ? 1.95 : n <= 5 ? 1.65 : 1.5}
              edit={patch && {
                bullets: slide.bullets ?? [],
                onChange: (bullets) => patch({ bullets }),
              }}
            />
          </Content>
        </>
      );
    }
    case 'two_column':
      return (
        <>
          <SlideTitle title={slide.title} c={c} accentTitle={accentTitle} edit={edit} />
          <Content>
            <div className="grid h-full grid-cols-2 gap-[4.5cqw]">
              {(['left', 'right'] as const).map((side) => {
                const col = slide[side];
                return (
                  <div key={side}>
                    {(col?.heading || patch) && (
                      <div className="mb-[1.2cqw] font-bold" style={{ ...cq(1.65), color: c.accent }}>
                        {patch ? (
                          <EditText
                            value={col?.heading ?? ''}
                            onChange={(heading) => patch({ [side]: { heading, bullets: col?.bullets ?? [] } })}
                            placeholder="Heading"
                            ariaLabel={`${side} heading`}
                          />
                        ) : col?.heading}
                      </div>
                    )}
                    <BulletList
                      bullets={col?.bullets ?? []}
                      c={c}
                      size={1.42}
                      edit={patch && {
                        bullets: col?.bullets ?? [],
                        onChange: (bullets) => patch({ [side]: { heading: col?.heading ?? '', bullets } }),
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </Content>
        </>
      );
    case 'chart':
      return (
        <>
          <SlideTitle title={slide.title} c={c} accentTitle={accentTitle} edit={edit} />
          <Content>
            <div className="flex h-full flex-col">
              {/* The app's chart component on a neutral panel: close to the
                  file's native chart, and it offers the table view. */}
              <div className="min-h-0 flex-1 overflow-hidden rounded bg-card text-foreground">
                {slide.chart && <ChartArtifact chart={{ ...slide.chart, title: '' }} />}
              </div>
              {(slide.caption || patch) && (
                <div className="mt-[0.6cqw] italic" style={{ ...cq(1), color: c.muted }}>
                  {patch ? (
                    <EditText value={slide.caption ?? ''} onChange={(caption) => patch({ caption })} placeholder="Caption" ariaLabel="Chart caption" />
                  ) : slide.caption}
                </div>
              )}
            </div>
          </Content>
        </>
      );
    case 'image':
      return (
        <>
          <SlideTitle title={slide.title} c={c} accentTitle={accentTitle} edit={edit} />
          <Content>
            <div className="flex h-full flex-col items-center justify-center gap-[1cqw] rounded" style={{ background: c.surface, color: c.muted }}>
              <ImageIcon style={{ width: '4cqw', height: '4cqw' }} />
              <span style={cq(1.1)}>{slide.image}</span>
            </div>
            {(slide.caption || patch) && (
              <div className="mt-[0.6cqw] text-center italic" style={{ ...cq(1), color: c.muted }}>
                {patch ? (
                  <EditText value={slide.caption ?? ''} onChange={(caption) => patch({ caption })} placeholder="Caption" ariaLabel="Image caption" />
                ) : slide.caption}
              </div>
            )}
          </Content>
        </>
      );
    case 'table':
      return (
        <>
          <SlideTitle title={slide.title} c={c} accentTitle={accentTitle} edit={edit} />
          <Content>
            <table className="w-full border-collapse" style={cq(1.05)}>
              <thead>
                <tr>
                  {(slide.columns ?? []).map((h, i) => (
                    <th key={i} className="px-[0.9cqw] py-[0.7cqw] text-left font-bold" style={{ background: c.accent, color: c.onAccent }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(slide.rows ?? []).map((row, r) => (
                  <tr key={r} style={{ background: r % 2 === 1 ? c.surface : c.bg }}>
                    {row.map((v, k) => <td key={k} className="px-[0.9cqw] py-[0.7cqw]">{v}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </Content>
        </>
      );
    case 'quote':
      return (
        <>
          <div className="absolute left-[8%] top-[8%] font-bold" style={{ ...cq(9), color: c.accent }}>{'“'}</div>
          <div className="absolute left-[14.25%] right-[14%] top-[29%] flex h-[40%] items-center italic" style={cq(2.25)}>
            {patch ? (
              <EditText value={slide.quote ?? ''} onChange={(quote) => patch({ quote })} multiline placeholder="Quote" ariaLabel="Quote" />
            ) : slide.quote}
          </div>
          {(slide.attribution || patch) && (
            <div className="absolute left-[14.25%] top-[71%]" style={{ ...cq(1.35), color: c.muted }}>
              {patch ? (
                <span className="flex gap-[0.5cqw]">—<EditText value={slide.attribution ?? ''} onChange={(attribution) => patch({ attribution })} placeholder="Attribution" ariaLabel="Attribution" /></span>
              ) : <>{'—'} {slide.attribution}</>}
            </div>
          )}
        </>
      );
    case 'stats': {
      const stats = slide.stats ?? [];
      return (
        <>
          <SlideTitle title={slide.title} c={c} accentTitle={accentTitle} edit={edit} />
          <Content>
            <div className="grid h-[70%] gap-[3cqw]" style={{ gridTemplateColumns: `repeat(${Math.max(stats.length, 1)}, minmax(0, 1fr))` }}>
              {stats.map((st, i) => (
                <div key={i} className="relative flex flex-col justify-center rounded-sm px-[2.2cqw]" style={{ background: c.surface }}>
                  <div className="absolute inset-x-0 top-0 h-[3%]" style={{ background: c.accent }} />
                  <div className="font-bold" style={{ ...cq(stats.length < 4 ? 3.6 : 3), color: c.accent }}>
                    {patch ? (
                      <EditText value={st.value} onChange={(value) => patch({ stats: stats.map((x, j) => (j === i ? { ...x, value } : x)) })} placeholder="0" ariaLabel={`Stat ${i + 1} value`} />
                    ) : st.value}
                  </div>
                  <div className="mt-[1cqw]" style={{ ...cq(1.27), color: c.muted }}>
                    {patch ? (
                      <EditText value={st.label} onChange={(label) => patch({ stats: stats.map((x, j) => (j === i ? { ...x, label } : x)) })} placeholder="Label" ariaLabel={`Stat ${i + 1} label`} />
                    ) : st.label}
                  </div>
                </div>
              ))}
            </div>
          </Content>
        </>
      );
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Workbooks
// ---------------------------------------------------------------------------

function WorkbookPreview({ spec }: { spec: WorkbookSpec }) {
  const [active, setActive] = useState(0);
  const sheet = spec.sheets[Math.min(active, spec.sheets.length - 1)];
  if (!sheet) return null;
  const chart = sheetChart(sheet);
  const totalled = new Set(sheet.totals);

  return (
    <div className="p-4">
      {spec.sheets.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Sheets">
          {spec.sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs transition-colors',
                i === active ? 'border-primary/40 bg-primary/10 font-medium text-foreground' : 'border-border/60 text-muted-foreground hover:text-foreground',
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-muted/40">
            <tr>
              {sheet.columns.map((col) => (
                <th key={col.header} className={cn(
                  'whitespace-nowrap border-b border-border/60 px-3 py-2 font-semibold',
                  col.type === 'text' || col.type === 'date' ? 'text-left' : 'text-right',
                )}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r} className={cn(r % 2 === 1 && 'bg-muted/20')}>
                {sheet.columns.map((col, k) => {
                  const cell = formatCell(row[k] ?? null, col);
                  return (
                    <td key={k} className={cn(
                      'whitespace-nowrap border-b border-border/40 px-3 py-1.5',
                      col.type === 'text' || col.type === 'date' ? 'text-left' : 'text-right',
                      cell.formula && 'font-mono text-[11px] text-muted-foreground',
                    )}>
                      {cell.text}
                    </td>
                  );
                })}
              </tr>
            ))}
            {sheet.totals.length > 0 && sheet.rows.length === sheet.row_count && (
              <tr className="font-semibold">
                {sheet.columns.map((col, k) => (
                  <td key={k} className="border-t border-border/80 px-3 py-1.5 text-right font-mono text-[11px] text-muted-foreground">
                    {k === 0 && !totalled.has(col.header) ? <span className="font-sans text-xs text-foreground">Total</span>
                      : totalled.has(col.header) ? 'SUM' : ''}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {sheet.rows.length < sheet.row_count
          ? `Showing ${sheet.rows.length} of ${sheet.row_count.toLocaleString()} rows. `
          : `${sheet.row_count.toLocaleString()} ${sheet.row_count === 1 ? 'row' : 'rows'}. `}
        Formulas are shown as written; Excel and Google Sheets calculate them when the file opens.
      </p>

      {sheet.chart && (
        <div className="mt-4">
          {chart ? (
            <ChartArtifact chart={chart} />
          ) : (
            <p className="rounded-md border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
              Chart “{sheet.chart.title}” is in the file. It plots calculated values, so it appears once the workbook is opened.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const UniverSheetPreview = lazy(() => import('../apps/UniverSheet').then((m) => ({
  default: function ReadOnlySheet({ snapshot }: { snapshot: unknown }) {
    const Sheet = m.default;
    return <Sheet snapshot={snapshot as IWorkbookData} readOnly />;
  },
})));

function LiveWorkbookPreview({ doc, className }: { doc: Document; className?: string }) {
  const [grid, setGrid] = useState<WorkbookGrid | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => {
    let cancelled = false;
    documentsService
      .workbook(doc.id)
      .then((g) => { if (!cancelled) setGrid(g); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [doc.id]);

  if (!grid) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        {failed ? 'This workbook could not be read.' : (<><Loader2 className="h-4 w-4 animate-spin" /> Loading…</>)}
      </div>
    );
  }
  const sheet = grid.sheets[Math.min(active, grid.sheets.length - 1)];
  // The app's own grid in read-only mode, so a file looks the same previewed
  // and opened. Without a snapshot (or when the engine cannot start), the
  // calculated-values table below is the fallback.
  if (sheet && (grid.snapshot as { sheets?: object } | undefined)?.sheets) {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden p-4', className)}>
        {grid.sheets.length > 1 && (
          <div className="mb-3 flex shrink-0 flex-wrap gap-1" role="tablist" aria-label="Sheets">
            {grid.sheets.map((s, i) => (
              <button
                key={s.name}
                type="button"
                role="tab"
                aria-selected={i === active}
                onClick={() => setActive(i)}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs transition-colors',
                  i === active ? 'border-primary/40 bg-primary/10 font-medium text-foreground' : 'border-border/60 text-muted-foreground hover:text-foreground',
                )}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          }
        >
          <UniverSheetPreview snapshot={grid.snapshot} />
        </Suspense>
      </div>
    );
  }
  const rows = (sheet?.values ?? sheet?.rows ?? []).slice(0, 200);
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return (
    <div className={cn('min-h-0 overflow-auto p-4', className)}>
      {grid.sheets.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Sheets">
          {grid.sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs transition-colors',
                i === active ? 'border-primary/40 bg-primary/10 font-medium text-foreground' : 'border-border/60 text-muted-foreground hover:text-foreground',
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">This sheet is empty.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full border-collapse text-xs">
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className={cn(r === 0 ? 'bg-muted/40 font-semibold' : r % 2 === 0 && 'bg-muted/20')}>
                  {Array.from({ length: width }, (_, c) => {
                    const v = row[c];
                    const text = v === null || v === undefined ? '' : String(v);
                    return (
                      <td
                        key={c}
                        className={cn(
                          'whitespace-nowrap border-b border-border/40 px-3 py-1.5',
                          typeof v === 'number' && 'text-right tabular-nums',
                          text.startsWith('=') && 'font-mono text-[11px] text-muted-foreground',
                        )}
                      >
                        {text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {sheet && sheet.row_count > rows.length ? `Showing ${rows.length} of ${sheet.row_count.toLocaleString()} rows. ` : ''}
        Calculated values where the file has them.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const TipTapPreview = lazy(() => import('../apps/TipTapEditor').then((m) => ({ default: m.TipTapReadOnly })));

/**
 * The app's own page in read-only mode, so a file looks the same previewed
 * and opened. TipTap loads lazily here exactly as in the editor.
 */
function DocumentPreview({ spec, docId }: { spec: DocumentSpec; docId: number }) {
  return (
    <div className="px-2 py-4 sm:px-6 sm:py-8">
      <article className="mx-auto max-w-3xl rounded-sm bg-card px-5 py-8 shadow-md sm:px-12 sm:py-12">
        <h1 className="m-0 text-2xl font-bold sm:text-3xl">{spec.title}</h1>
        {spec.subtitle && <p className="m-0 mt-1 text-base text-muted-foreground">{spec.subtitle}</p>}
        <div className="mt-4">
          <Suspense
            fallback={
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            }
          >
            <TipTapPreview docId={docId} spec={spec} />
          </Suspense>
        </div>
      </article>
    </div>
  );
}
