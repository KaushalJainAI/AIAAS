/**
 * Small text operations behind the editors' toolbar buttons.
 *
 * Pure, so the buttons can be tested without an editor: each takes text and
 * returns text. The editors apply them to the selection, or to the whole file
 * when nothing is selected.
 */

export interface TextStats {
  lines: number;
  words: number;
  chars: number;
}

export function textStats(text: string): TextStats {
  const trimmed = text.trim();
  return {
    lines: text === '' ? 0 : text.split('\n').length,
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    chars: text.length,
  };
}

/** "3 min read" — at 220 words a minute, never less than one. */
export function readingTime(words: number): string {
  return `${Math.max(1, Math.round(words / 220))} min read`;
}

export function sortLines(text: string): string {
  return text
    .split('\n')
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .join('\n');
}

/** Drop repeated lines, keeping the first of each and the original order. */
export function dedupeLines(text: string): string {
  const seen = new Set<string>();
  return text
    .split('\n')
    .filter((line) => {
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    })
    .join('\n');
}

export function trimTrailingSpaces(text: string): string {
  return text.replace(/[ \t]+$/gm, '');
}

export function titleCase(text: string): string {
  return text.toLowerCase().replace(/(^|[\s\-_(["'])([a-z])/g, (_m, lead: string, ch: string) => lead + ch.toUpperCase());
}

/** An empty Markdown table of the given size, with a header row. */
export function markdownTable(columns: number, rows: number): string {
  const cells = (fill: string) => `| ${Array.from({ length: columns }, () => fill).join(' | ')} |`;
  const header = `| ${Array.from({ length: columns }, (_v, i) => `Column ${i + 1}`).join(' | ')} |`;
  return [header, cells('---'), ...Array.from({ length: rows }, () => cells('   '))].join('\n');
}

/** A LaTeX `tabular` of the given size, booktabs-free so it builds anywhere. */
export function latexTable(columns: number, rows: number): string {
  const row = (fill: (i: number) => string) =>
    `  ${Array.from({ length: columns }, (_v, i) => fill(i)).join(' & ')} \\\\`;
  return [
    '\\begin{table}[h]',
    '  \\centering',
    `  \\begin{tabular}{${'l'.repeat(columns)}}`,
    '  \\hline',
    row((i) => `Column ${i + 1}`),
    '  \\hline',
    ...Array.from({ length: rows }, () => row(() => ' ')),
    '  \\hline',
    '  \\end{tabular}',
    '  \\caption{Caption}',
    '  \\label{tab:label}',
    '\\end{table}',
  ].join('\n');
}

/** `2026-10-10 14:05` in the reader's own time zone. */
export function timestamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** Step a font size inside the range the editors allow. */
export function stepFontSize(size: number, direction: 1 | -1): number {
  return Math.min(24, Math.max(10, size + direction));
}
