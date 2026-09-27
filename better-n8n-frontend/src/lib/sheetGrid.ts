/**
 * The Sheets app's grid, decided without rendering it.
 *
 * A grid is `string[][]` while it is being edited — what the user typed, as
 * typed. It becomes typed values only at save: a CSV is text anyway, and an
 * `.xlsx` cell edit sends a number when the text *is* a number and a formula
 * when it starts with `=`, which is how a spreadsheet reads a typed cell.
 */

export type Grid = string[][];
export type CellValue = string | number | boolean | null;

/** 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Row and column are 0-based; the reference is A1-style. */
export function cellRef(row: number, col: number): string {
  return `${columnName(col)}${row + 1}`;
}

/** A grid squared off to `rows` × `cols`, padding with empty cells. */
export function sizeGrid(grid: Grid, rows: number, cols: number): Grid {
  const out: Grid = [];
  for (let r = 0; r < rows; r += 1) {
    const src = grid[r] ?? [];
    const row: string[] = [];
    for (let c = 0; c < cols; c += 1) row.push(src[c] ?? '');
    out.push(row);
  }
  return out;
}

export function toText(value: CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/** What a typed cell means to a spreadsheet. */
export function typedValue(text: string): CellValue {
  if (text === '') return null;
  if (text.startsWith('=')) return text;
  const trimmed = text.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed) && !/^-?0\d/.test(trimmed)) {
    // A leading zero is an identifier ("007", a phone number), not a number.
    return Number(trimmed);
  }
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  return text;
}

/** Every cell that differs from `base`, as A1 edits. */
export function diffCells(base: Grid, next: Grid): { cell: string; value: CellValue }[] {
  const out: { cell: string; value: CellValue }[] = [];
  const rows = Math.max(base.length, next.length);
  for (let r = 0; r < rows; r += 1) {
    const cols = Math.max(base[r]?.length ?? 0, next[r]?.length ?? 0);
    for (let c = 0; c < cols; c += 1) {
      const before = base[r]?.[c] ?? '';
      const after = next[r]?.[c] ?? '';
      if (before !== after) out.push({ cell: cellRef(r, c), value: typedValue(after) });
    }
  }
  return out;
}

/** Split into chunks of at most `size` — the server takes 200 cell edits a call. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function quote(cell: string, delimiter: string): string {
  return /["\r\n]/.test(cell) || cell.includes(delimiter) || /^\s|\s$/.test(cell)
    ? `"${cell.replace(/"/g, '""')}"`
    : cell;
}

/** A grid as CSV. Trailing empty rows are dropped; interior ones are kept. */
export function toCsv(grid: Grid, delimiter: ',' | '\t' | ';' = ','): string {
  const rows = [...grid];
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  let width = 0;
  for (const row of rows) {
    let w = row.length;
    while (w > 0 && row[w - 1] === '') w -= 1;
    width = Math.max(width, w);
  }
  return rows.map((row) => sizeGrid([row], 1, width)[0].map((c) => quote(c, delimiter)).join(delimiter)).join('\n') + (rows.length ? '\n' : '');
}

// ---------------------------------------------------------------------------
// Markdown task lists (the To Do app)
// ---------------------------------------------------------------------------

export type TaskLine =
  | { kind: 'task'; done: boolean; text: string; indent: string }
  | { kind: 'other'; raw: string };

const TASK = /^(\s*)[-*+] \[( |x|X)\] ?(.*)$/;

/** Every line of a Markdown file, with task-list items recognised. */
export function parseTasks(text: string): TaskLine[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.map((raw) => {
    const m = TASK.exec(raw);
    return m ? { kind: 'task', indent: m[1], done: m[2] !== ' ', text: m[3] } : { kind: 'other', raw };
  });
}

/** The inverse of `parseTasks`: non-task lines come back exactly as they were. */
export function serializeTasks(lines: TaskLine[]): string {
  return (
    lines
      .map((l) => (l.kind === 'task' ? `${l.indent}- [${l.done ? 'x' : ' '}] ${l.text}` : l.raw))
      .join('\n') + '\n'
  );
}
