import { describe as group, expect, it } from 'vitest';
import { parseCsv } from '../csv';

group('parseCsv', () => {
  it('reads a plain file into headers and rows', () => {
    const t = parseCsv('name,qty\napples,3\npears,5\n');
    expect(t.headers).toEqual(['name', 'qty']);
    expect(t.rows).toEqual([['apples', '3'], ['pears', '5']]);
    expect(t.totalRows).toBe(2);
    expect(t.truncated).toBe(false);
  });

  it('keeps a delimiter that sits inside a quoted field', () => {
    // The failure a naive split(',') produces: one name becomes two columns
    // and every cell after it shifts under the wrong heading.
    const t = parseCsv('name,city\n"Smith, John",Pune\n');
    expect(t.rows).toEqual([['Smith, John', 'Pune']]);
  });

  it('reads a doubled quote as one literal quote', () => {
    const t = parseCsv('quote\n"she said ""hi"""\n');
    expect(t.rows).toEqual([['she said "hi"']]);
  });

  it('keeps a newline that sits inside a quoted field', () => {
    const t = parseCsv('note\n"line one\nline two"\n');
    expect(t.rows).toEqual([['line one\nline two']]);
    expect(t.totalRows).toBe(1);
  });

  it('handles CRLF without emitting blank rows', () => {
    const t = parseCsv('a,b\r\n1,2\r\n3,4\r\n');
    expect(t.rows).toEqual([['1', '2'], ['3', '4']]);
  });

  it('keeps the last row of a file with no trailing newline', () => {
    const t = parseCsv('a,b\n1,2');
    expect(t.rows).toEqual([['1', '2']]);
  });

  it('detects tabs and semicolons', () => {
    expect(parseCsv('a\tb\n1\t2\n').delimiter).toBe('\t');
    expect(parseCsv('a;b\n1;2\n').delimiter).toBe(';');
  });

  it('does not let a comma inside quotes outvote the real delimiter', () => {
    const t = parseCsv('"Smith, John";age\n"Doe, Jane";40\n');
    expect(t.delimiter).toBe(';');
    expect(t.headers).toEqual(['Smith, John', 'age']);
  });

  it('squares ragged rows off against the header', () => {
    const t = parseCsv('a,b,c\n1,2\n1,2,3,4\n');
    expect(t.rows).toEqual([['1', '2', ''], ['1', '2', '3']]);
  });

  it('caps rows and says that it did', () => {
    const body = Array.from({ length: 50 }, (_, i) => `r${i},${i}`).join('\n');
    const t = parseCsv(`a,b\n${body}\n`, 10);
    expect(t.rows).toHaveLength(10);
    expect(t.truncated).toBe(true);
    // The full count is reported even though the rows are not, so the preview
    // can say "10 of 50" rather than implying the file has ten rows.
    expect(t.totalRows).toBe(50);
  });

  it('leaves every cell as the string that was in the file', () => {
    // No type inference: a preview that renders 007 as 7, or reformats a date
    // into the reader's locale, shows something the file does not contain.
    const t = parseCsv('id,when\n007,2026-09-04\n');
    expect(t.rows).toEqual([['007', '2026-09-04']]);
  });

  it('treats an empty file as empty rather than one blank row', () => {
    expect(parseCsv('').rows).toEqual([]);
    expect(parseCsv('   \n\n').headers).toEqual([]);
  });

  it('strips a UTF-8 BOM off the first header', () => {
    // Excel writes one, and without this the first column is named BOM+"name"
    // and never matches anything the user searches for.
    const t = parseCsv('\uFEFFname,qty\na,1\n');
    expect(t.headers).toEqual(['name', 'qty']);
  });
});
