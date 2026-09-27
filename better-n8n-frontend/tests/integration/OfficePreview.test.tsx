/**
 * OfficePreview: a deck, a workbook and a Word document drawn from their stored spec.
 *
 * The specs below are the shape the office tools (`office/*::preview`) store in
 * `Document.metadata.spec`. The point is that each renders what the file says —
 * and that a document arriving from a listing (which leaves the spec out) is
 * fetched in full rather than shown as "no preview".
 */
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { fireEvent, render, screen } from '@testing-library/react';
import { server } from './setup';

import type { Document } from '../../src/api/documents';
import OfficePreview from '../../src/components/files/OfficePreview';

const THEME = {
  name: 'dark', background: '141414', surface: '232323', text: 'F2F2F2', muted: 'A6A6A6',
  accent: '3987E5', on_accent: 'FFFFFF', accent_title: false, rule: '3A3A3A',
  palette: ['3987E5', 'D95926'],
};

function doc(spec: unknown, extra: Partial<Document> = {}): Document {
  return {
    id: 7, title: 'x', filename: 'x', file_type: 'pptx', file_size: 1000, chunk_count: 0,
    is_shared: false, shared_at: null, created_at: '', updated_at: '', status: 'stored',
    metadata: spec === undefined ? {} : { spec },
    ...extra,
  };
}

describe('OfficePreview — decks', () => {
  it('draws every slide with its words, notes and the deck theme', () => {
    render(<OfficePreview doc={doc({
      kind: 'deck', title: 'EV', theme: THEME, slides: [
        { layout: 'title', title: 'EV market in India', subtitle: '2026 outlook' },
        { layout: 'bullets', title: 'What changed', notes: 'Stress subsidies',
          bullets: [{ text: '**Subsidies** moved', level: 0 }, { text: 'FAME III', level: 1 }] },
        { layout: 'stats', title: 'Numbers', stats: [{ value: '₹4.2 Cr', label: 'Revenue' }] },
        { layout: 'table', title: 'Models', columns: ['Model'], rows: [['Ather']] },
        { layout: 'quote', quote: 'Electrify early.', attribution: 'An analyst' },
        { layout: 'chart', title: 'Revenue', chart: { kind: 'column', title: 'Revenue', series: [
          { name: 'Rev', points: [{ x: 'Q1', y: 3.1 }] }] } },
      ],
    })} />);

    // One slide at a time, the way the Slides app presents it: walk the deck
    // with the Next button and check each slide's own words.
    const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    expect(screen.getByText('1 / 6')).toBeInTheDocument();
    expect(screen.getByText(/dark theme · in-browser preview/)).toBeInTheDocument();
    expect(screen.getByText('EV market in India')).toBeInTheDocument();
    next();
    expect(screen.getByText('Subsidies').tagName).toBe('STRONG');
    expect(screen.getByText('FAME III')).toBeInTheDocument();
    expect(screen.getByText(/Stress subsidies/)).toBeInTheDocument();
    next();
    expect(screen.getByText('₹4.2 Cr')).toBeInTheDocument();
    next();
    expect(screen.getByText('Ather')).toBeInTheDocument();
    next();
    expect(screen.getByText(/An analyst/)).toBeInTheDocument();
    next();
    expect(screen.getByText('6 / 6')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next slide' })).toBeDisabled();
  });

  it('renders stored text as text, never as markup', () => {
    render(<OfficePreview doc={doc({
      kind: 'deck', title: 't', theme: THEME,
      slides: [{ layout: 'section', title: '<img src=x onerror=alert(1)>' }],
    })} />);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('OfficePreview — workbooks', () => {
  it('shows typed values, formulas as written, and one tab per sheet', () => {
    render(<OfficePreview doc={doc({
      kind: 'workbook', sheets: [
        { name: 'Sales', row_count: 2, totals: ['Revenue'], chart: null,
          columns: [{ header: 'Region', type: 'text' }, { header: 'Revenue', type: 'currency', currency: 'INR' }],
          rows: [['North', 1450], ['South', '=B2*2']] },
        { name: 'Notes', row_count: 1, totals: [], chart: null,
          columns: [{ header: 'Item', type: 'text' }], rows: [['Prices exclude GST']] },
      ],
    }, { file_type: 'xlsx' })} />);

    expect(screen.getByText('₹1,450.00')).toBeInTheDocument();
    expect(screen.getByText('=B2*2')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(screen.getByText('Prices exclude GST')).toBeInTheDocument();
  });
});

describe('OfficePreview — documents', () => {
  it('draws headings, emphasis, lists and tables', async () => {
    render(<OfficePreview doc={doc({
      kind: 'document', title: 'Q3 review', subtitle: 'For the board', accent: '2A78D6', blocks: [
        { type: 'heading', text: 'Summary', level: 1 },
        { type: 'paragraph', text: 'Revenue grew **38%**.' },
        { type: 'bullets', items: ['One'] },
        { type: 'table', columns: ['A'], rows: [['1']], caption: 'Table 1' },
      ],
    }, { file_type: 'docx' })} />);

    // The preview is the Docs editor read-only, which loads lazily.
    expect(await screen.findByRole('heading', { name: 'Summary' }, { timeout: 5000 }))
      .toBeInTheDocument();
    expect(screen.getByText('38%').tagName).toBe('STRONG');
    expect(screen.getByText('Table 1')).toBeInTheDocument();
  });
});

describe('OfficePreview — a document from a listing', () => {
  it('fetches the detail when the spec was left out', async () => {
    server.use(http.get('http://localhost:8000/api/inference/documents/7/', () =>
      HttpResponse.json(doc({ kind: 'deck', title: 't', theme: THEME,
        slides: [{ layout: 'section', title: 'Fetched in full' }] }))));
    render(<OfficePreview doc={doc(undefined)} />);
    expect(await screen.findByText('Fetched in full')).toBeInTheDocument();
  });

  it('falls back to extracted text for an uploaded file with no spec', () => {
    render(<OfficePreview doc={doc(undefined, { file_type: 'docx', content: 'Uploaded memo text' })} />);
    expect(screen.getByText('Uploaded memo text')).toBeInTheDocument();
  });
});
