/**
 * Closes what a half-received message left open, for display only.
 *
 * While an answer streams, the browser sees markdown that is not valid yet:
 * `**bold` with no closer, a link whose URL is half typed, a code span opened
 * one character ago. CommonMark renders those as literal characters, so the
 * text visibly jumps — the `**` sits on screen until the closing run arrives,
 * then vanishes and the words go bold.
 *
 * This repairs the **last block only**. Everything before it is settled: it
 * parsed once and will not change again, so healing it would risk changing text
 * the model has already finished writing, which is the one thing a display
 * transform must never do. A fenced block is skipped entirely — an unclosed
 * fence is *already* code to the end of the document, and appending a closer to
 * it would terminate the block early.
 *
 * The false positives are the interesting part, because a naive version mangles
 * ordinary prose:
 *
 *     20~25°C          a single `~` is not `~~`
 *     snake_case       `_` inside a word is not emphasis
 *     a * b            an opener must be followed by a non-space
 *     1 * 2 * 3        ...and a closer preceded by a non-space
 *
 * Both flanking rules above are CommonMark's, which is why they are implemented
 * rather than approximated: they are what makes the difference between healing
 * a span and changing the words.
 */

/** A fence line: three or more ` or ~, optionally indented. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** `[label](url` with no closing paren — the URL is still arriving. */
const OPEN_LINK = /(!?)\[([^\]]*)\]\([^)\n]*$/;

/** `**`, `__`, `~~`, `*`, `_` — a run we might have to close. */
const DELIMITER = /\*\*|__|~~|\*|_/g;

const WHITESPACE = /\s/;

function isWordChar(char: string | undefined): boolean {
  return !!char && /[\p{L}\p{N}]/u.test(char);
}

/**
 * The index where the last block starts, or 0 when there is only one.
 *
 * A blank line ends a block, but only outside a fence: inside one, blank lines
 * are content. Returns 0 as soon as the scan is inside an open fence at the
 * end, which makes the caller skip healing.
 */
function lastBlockStart(markdown: string): number {
  const lines = markdown.split('\n');
  let fence: string | null = null;
  let blankRun = -1;
  let offset = 0;
  let start = 0;

  for (const line of lines) {
    const opened = FENCE.exec(line);

    if (opened) {
      const marker = opened[1][0];
      if (!fence) fence = marker;
      else if (marker === fence) fence = null;
      blankRun = -1;
    } else if (!fence && line.trim() === '') {
      if (blankRun < 0) blankRun = offset;
    } else if (blankRun >= 0) {
      // The line after a blank run is the start of the next block.
      start = offset;
      blankRun = -1;
    }

    offset += line.length + 1;
  }

  // Still inside a fence: the tail is code, and code needs no healing.
  if (fence) return -1;
  return start;
}

/**
 * Closes an unclosed code span in `tail`, or drops a backtick nobody typed
 * content after.
 *
 * Only runs of one length are handled. Mixed lengths (``` ``a` ``) are valid
 * markdown that this would have to re-implement to get right, and the common
 * case — one run opening, one closing — needs none of that.
 */
function healCodeSpan(tail: string): string {
  const runs: { index: number; length: number }[] = [];
  for (let index = 0; index < tail.length; index += 1) {
    if (tail[index] !== '`') continue;
    let length = 1;
    while (tail[index + length] === '`') length += 1;
    runs.push({ index, length });
    index += length - 1;
  }

  if (runs.length === 0 || new Set(runs.map((run) => run.length)).size !== 1) {
    return tail;
  }
  if (runs.length % 2 === 0) return tail;

  const last = runs[runs.length - 1];
  // A lone opener at the very end is a keystroke, not a span: dropping it is
  // less surprising than painting an empty code chip.
  if (last.index + last.length >= tail.length) return tail.slice(0, last.index);
  return tail + '`'.repeat(last.length);
}

/** The tail with every closed code span blanked, so delimiters in code do not count. */
function maskCode(text: string): string {
  return text.replace(/(`+)([\s\S]*?)\1/g, (match) => ' '.repeat(match.length));
}

/** Rewrites a half-typed link to its label: `see [docs](htt` → `see docs`. */
function healLink(tail: string): string {
  return tail.replace(OPEN_LINK, (_match, image: string, label: string) =>
    image ? '' : label,
  );
}

/**
 * Appends the delimiters still open at the end of `text`.
 *
 * The flanking tests are the whole point: without them, `snake_case` and
 * `20~25°C` grow a stray closer and the words change.
 */
function closeEmphasis(text: string): string {
  if (!text.includes('*') && !text.includes('_') && !text.includes('~')) return text;

  const masked = maskCode(text);
  const open: string[] = [];
  let match: RegExpExecArray | null;
  const pattern = new RegExp(DELIMITER);

  while ((match = pattern.exec(masked)) !== null) {
    const delimiter = match[0];
    const before = masked[match.index - 1];
    const after = masked[match.index + delimiter.length];

    // A closer needs a non-space before it; an opener needs a non-space after
    // it. `_` additionally may not sit inside a word.
    const canClose = !!before && !WHITESPACE.test(before);
    const canOpen = !!after && !WHITESPACE.test(after);
    const intraword = delimiter.includes('_') && isWordChar(before) && isWordChar(after);

    if (canClose && open[open.length - 1] === delimiter) {
      open.pop();
    } else if (canOpen && !intraword) {
      open.push(delimiter);
    }
  }

  if (open.length === 0) return text;

  // A closer cannot follow whitespace, so the trailing space goes with the
  // closer. One space, not the sentence: this is a display repair.
  return text.trimEnd() + [...open].reverse().join('');
}

/**
 * The message as it should be drawn while it is still arriving.
 *
 * Returns the input unchanged when there is nothing to repair, so the caller
 * can memoise on the string and pay nothing for settled messages.
 */
export function healStreamingTail(markdown: string): string {
  if (!markdown) return markdown;

  const start = lastBlockStart(markdown);
  if (start < 0) return markdown;

  const head = markdown.slice(0, start);
  const original = markdown.slice(start);

  let tail = healCodeSpan(original);
  tail = healLink(tail);
  tail = closeEmphasis(tail);

  return tail === original ? markdown : head + tail;
}
