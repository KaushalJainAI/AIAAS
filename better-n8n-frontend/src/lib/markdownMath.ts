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

/** A literal dollar that remark-math cannot read as a delimiter. */
const DOLLAR = '&#36;';

/** Index just past the inline code span opened by `run` backticks at `start`, or -1 if unclosed. */
function codeSpanEnd(line: string, start: number, run: number): number {
  let index = start + run;
  while (index < line.length) {
    if (line[index] !== '`') {
      index += 1;
      continue;
    }
    let close = 1;
    while (line[index + close] === '`') close += 1;
    if (close === run) return index + close;
    index += close;
  }
  return -1;
}

/**
 * Escape a `$` that is a price, not the start of a formula.
 *
 * `remark-math` pairs any two dollars, so "launched at $399 … was $299" became
 * one long italic formula that also swallowed the bold and the links between
 * them. The rule is Pandoc's: an opening `$` must be followed by a non-space,
 * and the next `$` on the line closes it only if it follows a non-space and
 * is not followed by a digit. An opener with no such closer is a price and is
 * written as `&#36;`. Not `\$`: remark-math 6 still opens maths on an escaped
 * dollar, while an entity is decoded to text after maths has been tokenised.
 * `$x^2$` and `$2^n$` still render; "$5 and $10" and "$5-$10" do not.
 */
function escapeCurrencyLine(line: string): string {
  if (!line.includes('$')) return line;

  let out = '';
  let index = 0;

  while (index < line.length) {
    const char = line[index];

    if (char === '`') {
      let run = 1;
      while (line[index + run] === '`') run += 1;
      const end = codeSpanEnd(line, index, run);
      const stop = end === -1 ? index + run : end;
      out += line.slice(index, stop);
      index = stop;
      continue;
    }

    // A dollar the author escaped is a price too, and needs the same entity.
    if (char === '\\') {
      out += line[index + 1] === '$' ? DOLLAR : line.slice(index, index + 2);
      index += 2;
      continue;
    }

    if (char !== '$') {
      out += char;
      index += 1;
      continue;
    }

    // `$$` is display maths; leave it to remark-math.
    if (line[index + 1] === '$') {
      out += '$$';
      index += 2;
      continue;
    }

    const closer = inlineMathCloser(line, index);
    if (closer === -1) {
      out += DOLLAR;
      index += 1;
      continue;
    }

    out += line.slice(index, closer + 1);
    index = closer + 1;
  }

  return out;
}

/** The index of the `$` closing inline maths opened at `open`, or -1 if it is not maths. */
function inlineMathCloser(line: string, open: number): number {
  const first = line[open + 1];
  if (first === undefined || /\s/.test(first)) return -1;

  let index = open + 1;
  while (index < line.length) {
    const char = line[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    // Maths does not run into code.
    if (char === '`') return -1;
    if (char === '$') {
      const before = line[index - 1];
      const after = line[index + 1];
      if (after === '$') return -1;
      if (/\s/.test(before) || (after !== undefined && /\d/.test(after))) return -1;
      return index;
    }
    index += 1;
  }
  return -1;
}

/**
 * Prepare prose for `remark-math`: escape prices written with `$`, then
 * rewrite LaTeX delimiters, leaving fenced blocks and inline code as they
 * were written.
 *
 * Multi-line `\\[ … \\]` works because only the delimiters are rewritten and
 * they sit on their own lines. Prices are escaped first because `\\( x \\)`
 * becomes `$ x $`, which the price rule would otherwise read as two prices.
 */
export function normalizeMathDelimiters(markdown: string): string {
  if (!markdown.includes('$') && !markdown.includes('\\(') && !markdown.includes('\\[')) return markdown;

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
      return normalizeLine(escapeCurrencyLine(line));
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
