/**
 * The specs the office tools store beside a rendered file, as the preview reads them.
 *
 * `render_deck`, `render_workbook` and `render_document` save the bytes *and*
 * the structure that produced them (`Document.metadata.spec`, written by
 * `chat/tools/office/*::preview`). The browser cannot draw a slide from
 * `.pptx` bytes, but it can draw one from its spec, so the preview is built
 * from this — the same "store the spec, not a picture" rule charts follow.
 *
 * Parsing is defensive and returns null for anything unrecognised: the
 * metadata column is free-form JSON and an uploaded `.docx` has none, and a
 * preview that throws takes the drawer into the error boundary with it.
 */

import type { ChartSpec } from '../api/chat';

export interface DeckTheme {
  name: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  on_accent: string;
  accent_title: boolean;
  rule: string;
  palette: string[];
}

export interface Bullet {
  text: string;
  level: 0 | 1;
}

export interface Slide {
  layout: 'title' | 'section' | 'bullets' | 'two_column' | 'chart' | 'image'
    | 'table' | 'quote' | 'stats' | 'closing';
  title?: string;
  subtitle?: string;
  bullets?: Bullet[];
  left?: { heading: string; bullets: Bullet[] };
  right?: { heading: string; bullets: Bullet[] };
  chart?: ChartSpec;
  image?: string;
  caption?: string;
  columns?: string[];
  rows?: string[][];
  quote?: string;
  attribution?: string;
  stats?: { value: string; label: string }[];
  notes?: string;
}

export interface DeckSpec {
  kind: 'deck';
  title: string;
  theme: DeckTheme;
  slides: Slide[];
}

export type ColumnType = 'text' | 'number' | 'integer' | 'currency' | 'percent' | 'date';

export interface SheetColumn {
  header: string;
  type: ColumnType;
  currency?: string;
}

export type Cell = string | number | boolean | null;

export interface Sheet {
  name: string;
  columns: SheetColumn[];
  rows: Cell[][];
  row_count: number;
  totals: string[];
  chart: { kind: ChartSpec['kind']; title: string; x: string; y: string[] } | null;
}

export interface WorkbookSpec {
  kind: 'workbook';
  sheets: Sheet[];
}

/** One inline run: text with its own marks, as TipTap and the importer write. */
export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: string;
}

export type Align = 'left' | 'center' | 'right' | 'justify';

/**
 * A list item: a marker string, or an object with text/runs like a paragraph.
 * `level` survives the TipTap round trip (nested lists); the file renders
 * document lists flat.
 */
export type ListItem = string | { text?: string; runs?: TextRun[]; level?: 0 | 1 };

export type Block =
  | { type: 'heading'; text?: string; runs?: TextRun[]; level: 1 | 2 | 3; align?: Align }
  | { type: 'paragraph' | 'quote'; text?: string; runs?: TextRun[]; align?: Align }
  | { type: 'bullets' | 'numbered'; items: ListItem[] }
  | { type: 'table'; columns: string[]; rows: string[][]; caption: string }
  | { type: 'image'; path: string; caption: string }
  | { type: 'chart'; chart: ChartSpec }
  | { type: 'page_break' };

export interface DocumentSpec {
  kind: 'document';
  title: string;
  subtitle: string;
  accent: string;
  blocks: Block[];
}

export type OfficeSpec = DeckSpec | WorkbookSpec | DocumentSpec;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The stored spec, or null when there is none this preview can draw. */
export function officeSpecOf(metadata: Record<string, unknown> | undefined): OfficeSpec | null {
  const spec = metadata?.spec;
  if (!isObj(spec)) return null;
  if (spec.kind === 'deck' && Array.isArray(spec.slides) && isObj(spec.theme)) {
    return spec as unknown as DeckSpec;
  }
  if (spec.kind === 'workbook' && Array.isArray(spec.sheets)) {
    return spec as unknown as WorkbookSpec;
  }
  if (spec.kind === 'document' && Array.isArray(spec.blocks)) {
    return spec as unknown as DocumentSpec;
  }
  return null;
}

/** A hex colour from a stored theme, or a fallback when it is not one. */
export function hex(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[0-9a-fA-F]{6}$/.test(value) ? `#${value}` : fallback;
}

export type Span = { text: string; bold?: boolean; italic?: boolean };

/**
 * `**bold**` and `*italic*` split into spans, matching what the renderers put
 * in the file (`deck._runs`, `document._inline`). Returned as data rather than
 * as markup, so no stored string ever reaches the DOM as HTML.
 */
export function spans(text: string, { italic = true } = {}): Span[] {
  const pattern = italic ? /(\*\*.+?\*\*|\*[^*\s][^*]*?\*)/g : /(\*\*.+?\*\*)/g;
  const out: Span[] = [];
  for (const part of text.split(pattern)) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      out.push({ text: part.slice(2, -2), bold: true });
    } else if (italic && part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      out.push({ text: part.slice(1, -1), italic: true });
    } else {
      out.push({ text: part });
    }
  }
  return out;
}

const CURRENCY: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥' };

/**
 * A cell as the workbook will show it once opened. Formulas are shown as the
 * formula: the browser does not evaluate them, and a computed-looking number
 * we made up would be worse than the honest `=SUM(B2:B9)`.
 */
export function formatCell(value: Cell, column: SheetColumn): { text: string; formula: boolean } {
  if (value === null || value === undefined || value === '') return { text: '', formula: false };
  if (typeof value === 'string' && value.startsWith('=')) return { text: value, formula: true };
  if (typeof value === 'boolean') return { text: value ? 'TRUE' : 'FALSE', formula: false };
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[,%₹$€£¥\s]/g, ''));
  if (!Number.isFinite(n) || column.type === 'text' || column.type === 'date') {
    return { text: String(value), formula: false };
  }
  switch (column.type) {
    case 'integer':
      return { text: Math.round(n).toLocaleString('en-US'), formula: false };
    case 'percent': {
      const fraction = typeof value === 'string' && value.trim().endsWith('%') ? n / 100 : n;
      return { text: `${(fraction * 100).toFixed(1)}%`, formula: false };
    }
    case 'currency':
      return {
        text: `${CURRENCY[column.currency ?? ''] ?? ''}${n.toLocaleString('en-US', {
          minimumFractionDigits: 2, maximumFractionDigits: 2,
        })}`,
        formula: false,
      };
    default:
      return { text: n.toLocaleString('en-US', { maximumFractionDigits: 2 }), formula: false };
  }
}

/**
 * A sheet's chart as a `ChartSpec`, or null when it cannot be drawn honestly
 * in the browser — any plotted cell that is a formula has no value until a
 * spreadsheet computes it, and inventing one would misstate the file.
 */
export function sheetChart(sheet: Sheet): ChartSpec | null {
  const c = sheet.chart;
  if (!c) return null;
  const xi = sheet.columns.findIndex((col) => col.header === c.x);
  const yis = c.y.map((h) => sheet.columns.findIndex((col) => col.header === h));
  if (xi < 0 || yis.some((i) => i < 0) || sheet.rows.length < sheet.row_count) return null;
  const series = [];
  for (const [k, yi] of yis.entries()) {
    const points = [];
    for (const row of sheet.rows) {
      const y = row[yi];
      if (typeof y === 'string' && y.startsWith('=')) return null;
      const n = typeof y === 'number' ? y : y === null ? null : Number(String(y).replace(/[,%₹$€£¥\s]/g, ''));
      points.push({ x: String(row[xi] ?? ''), y: n !== null && Number.isFinite(n) ? n : null });
    }
    series.push({ name: c.y[k], points });
  }
  return { kind: c.kind, title: c.title, series } as ChartSpec;
}
