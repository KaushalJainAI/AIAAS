import { describe, expect, it } from 'vitest';

import { formatCell, hex, officeSpecOf, sheetChart, spans, type Sheet } from '../officeSpec';
import { kindOf } from '../filePreview';

describe('officeSpecOf', () => {
  it('reads each of the three stored kinds', () => {
    expect(officeSpecOf({ spec: { kind: 'deck', slides: [], theme: {} } })?.kind).toBe('deck');
    expect(officeSpecOf({ spec: { kind: 'workbook', sheets: [] } })?.kind).toBe('workbook');
    expect(officeSpecOf({ spec: { kind: 'document', blocks: [] } })?.kind).toBe('document');
  });

  it('answers null for anything it cannot draw, rather than throwing', () => {
    expect(officeSpecOf(undefined)).toBeNull();
    expect(officeSpecOf({})).toBeNull();
    expect(officeSpecOf({ spec: 'deck' })).toBeNull();
    expect(officeSpecOf({ spec: { kind: 'deck' } })).toBeNull();
    expect(officeSpecOf({ spec: { kind: 'hologram', slides: [] } })).toBeNull();
  });
});

describe('kindOf', () => {
  it('previews office files from their spec, never as text', () => {
    const doc = (filename: string, file_type: string) => ({ filename, file_type });
    expect(kindOf(doc('q3.pptx', 'pptx'))).toBe('office');
    expect(kindOf(doc('q3.xlsx', 'xlsx'))).toBe('office');
    // An uploaded Word file: read as text it was zip noise.
    expect(kindOf(doc('memo.docx', 'docx'))).toBe('office');
  });

  it('shows a format we cannot parse as media, never as text', () => {
    const doc = (filename: string, file_type: string) => ({ filename, file_type });
    expect(kindOf(doc('data.parquet', 'other'))).toBe('media');
    expect(kindOf(doc('song.mp3', 'audio'))).toBe('media');
    // Code and config still read as code: they are sniffed as text on upload.
    expect(kindOf(doc('deploy.py', 'txt'))).toBe('code');
  });
});

describe('spans', () => {
  it('splits bold and italic into data, never markup', () => {
    expect(spans('grew **38%** and *9%*')).toEqual([
      { text: 'grew ' }, { text: '38%', bold: true }, { text: ' and ' }, { text: '9%', italic: true },
    ]);
    expect(spans('<b>x</b>')).toEqual([{ text: '<b>x</b>' }]);
  });

  it('leaves single asterisks alone where the file does', () => {
    expect(spans('a *b*', { italic: false })).toEqual([{ text: 'a *b*' }]);
  });
});

describe('hex', () => {
  it('accepts only a six-digit colour', () => {
    expect(hex('2A78D6', '#000')).toBe('#2A78D6');
    expect(hex('red;background:url(x)', '#000')).toBe('#000');
    expect(hex(undefined, '#000')).toBe('#000');
  });
});

describe('formatCell', () => {
  it('shows a formula as written, never a made-up value', () => {
    expect(formatCell('=B2*C2', { header: 'R', type: 'currency', currency: 'INR' }))
      .toEqual({ text: '=B2*C2', formula: true });
  });

  it('formats by column type', () => {
    expect(formatCell(1450, { header: 'P', type: 'currency', currency: 'INR' }).text).toBe('₹1,450.00');
    expect(formatCell(0.19, { header: 'M', type: 'percent' }).text).toBe('19.0%');
    expect(formatCell('19%', { header: 'M', type: 'percent' }).text).toBe('19.0%');
    expect(formatCell(1200.4, { header: 'U', type: 'integer' }).text).toBe('1,200');
    expect(formatCell(null, { header: 'U', type: 'integer' }).text).toBe('');
  });
});

describe('sheetChart', () => {
  const sheet = (rows: Sheet['rows'], row_count = rows.length): Sheet => ({
    name: 'S',
    columns: [{ header: 'Region', type: 'text' }, { header: 'Revenue', type: 'number' }],
    rows,
    row_count,
    totals: [],
    chart: { kind: 'column', title: 'Revenue', x: 'Region', y: ['Revenue'] },
  });

  it('draws a chart over plain values', () => {
    const chart = sheetChart(sheet([['North', 120], ['South', null]]));
    expect(chart?.series[0].points).toEqual([{ x: 'North', y: 120 }, { x: 'South', y: null }]);
  });

  it('declines when a plotted cell is a formula or rows are missing', () => {
    expect(sheetChart(sheet([['North', '=B2*2']]))).toBeNull();
    expect(sheetChart(sheet([['North', 1]], 500))).toBeNull();
  });
});
