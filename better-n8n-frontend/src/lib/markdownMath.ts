/**
 * LaTeX delimiters, normalised for `remark-math`.
 *
 * `remark-math` understands `$…$` and `$$…$$` and nothing else. Models trained
 * on LaTeX prose overwhelmingly write `\\(…\\)` and `\\[…\\]`, so without this
 * pass those arrive as literal backslashes and brackets — the single most
 * visible formatting break in a multi-model chat.
 *
 * The rewrite is done here, line by line, rather than by a plain regex over
 * the whole message, because a plain regex reproduces the bug that started all
 * this: it would also rewrite the escaped delimiters inside code blocks and
 * inline code, where they are code and must stay exactly as written.
 *
 * Fence tracking is deliberately simple — three or more backticks or tildes
 * at the start of a line open a block, the same character closes it — which is
 * what CommonMark does. Inline code is tracked by backtick runs within a line.
 */

/** A fence line: three or more ` or ~, optionally followed by an info string. */
const FENCE = /^(\s*)(`{3,}|~{3,})/;

/** Replace `\(…\)` and `\[…\]` with `$…$` and `$$…$$` outside code. */
function normalizeLine(line: string): string {
  let out = '';
  let index = 0;
  let fenceRun = 0;

  while (index < line.length) {
    const char = line[index];

    // A backtick run of length N opens inline code; the next run of length N
    // closes it. Copy the whole span untouched.
    if (char === '`') {
      let run = 1;
      while (line[index + run] === '`') run += 1;

      if (fenceRun === 0) {
        fenceRun = run;
        out += '`'.repeat(run);
        index += run;
        continue;
      }
      if (run === fenceRun) {
        fenceRun = 0;
        out += '`'.repeat(run);
        index += run;
        continue;
      }

      out += '`'.repeat(run);
      index += run;
      continue;
    }

    if (fenceRun === 0 && char === '\\' && index + 1 < line.length) {
      const next = line[index + 1];
      if (next === '(' || next === ')') {
        out += '$';
        index += 2;
        continue;
      }
      if (next === '[' || next === ']') {
        out += '$$';
        index += 2;
        continue;
      }
    }

    out += char;
    index += 1;
  }

  return out;
}

/**
 * Rewrite LaTeX delimiters in prose, leaving fenced blocks and inline code as
 * they were written.
 *
 * Multi-line `\\[ … \\]` works because only the delimiters are rewritten and
 * they sit on their own lines.
 */
export function normalizeMathDelimiters(markdown: string): string {
  if (!markdown.includes('\\(') && !markdown.includes('\\[')) return markdown;

  const lines = markdown.split('\n');
  let fence: string | null = null;

  return lines
    .map((line) => {
      const opened = FENCE.exec(line);

      if (opened) {
        const marker = opened[2][0];

        // Closing must match the opening character; ``` inside a ~~~ block is content.
        if (!fence) fence = marker;
        else if (marker === fence) fence = null;

        return line;
      }

      if (fence) return line;
      return normalizeLine(line);
    })
    .join('\n');
}

/**
 * Whether the text is worth loading KaTeX for.
 *
 * The plain form of every delimiter we render, plus `$$`. A false positive
 * costs one lazy chunk; a false negative is a message of raw LaTeX.
 */
export function looksLikeMath(markdown: string): boolean {
  return markdown.includes('$') || markdown.includes('\\(') || markdown.includes('\\[');
}
