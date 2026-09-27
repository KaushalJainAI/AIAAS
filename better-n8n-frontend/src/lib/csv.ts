/**
 * A small CSV/TSV reader for previewing a delimited file.
 *
 * Deliberately not a dependency. The job here is one screen's worth of rows out
 * of a file the user already owns, and the parts of RFC 4180 that actually bite
 * — a quoted field containing the delimiter, a doubled quote inside a quoted
 * field, a newline inside a quoted field — are the parts a naive `split(',')`
 * gets wrong, and they are about forty lines to get right.
 *
 * What it deliberately does not do: type inference. A preview that decides
 * `007` is the number 7, or that `2026-09-04` is a date in the reader's own
 * locale, shows the user something their file does not contain. Every cell
 * comes back as the string that was in the file.
 */

/** How many rows a preview asks for unless it says otherwise. */
export const CSV_PREVIEW_ROWS = 200;

export interface CsvTable {
  /** The first row, treated as headers. Empty when the file is empty. */
  headers: string[];
  /** Body rows, each padded or trimmed to `headers.length`. */
  rows: string[][];
  /** True when the file had more rows than were returned. */
  truncated: boolean;
  /** Total body rows in the file, whether or not they were returned. */
  totalRows: number;
  /** Which delimiter was detected, for display. */
  delimiter: ',' | '\t' | ';';
}

/**
 * Guess the delimiter from the first line.
 *
 * Counting outside quotes matters: `"Smith, John";42` is one semicolon-
 * delimited row that a naive count reads as comma-delimited, which then splits
 * the name in half — a wrong guess here is not a formatting nit, it changes how
 * many columns the file appears to have.
 */
function detectDelimiter(text: string): ',' | '\t' | ';' {
  const line = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  let inQuotes = false;
  const counts = { ',': 0, '\t': 0, ';': 0 };

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && (ch === ',' || ch === '\t' || ch === ';')) {
      counts[ch] += 1;
    }
  }

  if (counts['\t'] > counts[','] && counts['\t'] >= counts[';']) return '\t';
  if (counts[';'] > counts[',']) return ';';
  return ',';
}

/** Every row of the text, honouring quotes. */
function splitRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // A doubled quote is one literal quote; a single one ends the field.
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      // Swallow the LF of a CRLF pair rather than emitting a blank row.
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  // A file not ending in a newline still has a last row.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export function parseCsv(text: string, maxRows: number = CSV_PREVIEW_ROWS): CsvTable {
  // Excel writes a BOM; left in place it becomes part of the first header name
  // and that column never matches anything the user searches for.
  const trimmed = text.replace(/^\uFEFF/, '');
  if (!trimmed.trim()) {
    return { headers: [], rows: [], truncated: false, totalRows: 0, delimiter: ',' };
  }

  const delimiter = detectDelimiter(trimmed);
  const all = splitRows(trimmed, delimiter).filter(
    // A row of one empty cell is a blank line, not a record.
    (r) => !(r.length === 1 && r[0] === '')
  );

  const headers = all[0] ?? [];
  const body = all.slice(1);
  const width = headers.length;

  const rows = body.slice(0, maxRows).map((r) => {
    // Squared off against the header, because a ragged row rendered as-is
    // shifts every cell after it under the wrong column heading.
    const out = r.slice(0, width);
    while (out.length < width) out.push('');
    return out;
  });

  return {
    headers,
    rows,
    truncated: body.length > rows.length,
    totalRows: body.length,
    delimiter,
  };
}
