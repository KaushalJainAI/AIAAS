/**
 * Puts a citation pill where the provider says the sentence was cited.
 *
 * Perplexity and most open models write `[1]` themselves, and
 * `remarkCitations` draws those. OpenAI and Gemini do not: they send a source
 * list plus character spans into the answer, so the answer needs no marker in
 * the text and the UI has to place one. The backend resolves each span to
 * character offsets against the final answer (`llm/citations.py`) — including
 * Gemini's UTF-8 byte offsets — and this splices the marker in.
 *
 * **Why this is a splice, not a scan.** The bug that started all this was a
 * regex rewriting every `[n]` in the raw markdown, including the ones inside
 * code. Here the position is given, not searched for, so there is nothing to
 * misinterpret — with one exception, and it is handled explicitly: a provider
 * could put a span inside a fenced block (citing a snippet it showed earlier).
 * A marker spliced into a fence would corrupt the code on copy, so spans that
 * touch a fence are dropped rather than trusted.
 *
 * The marker is inserted at the *end* of the cited span, which is where a
 * footnote-style reference belongs: after the sentence it supports, before the
 * punctuation that follows.
 */

/** A fence line: three or more ` or ~, indented at most three spaces. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export interface SpanSource {
  url?: string;
  /** Character offset into the answer text, from the provider. */
  start?: number;
  /** Exclusive end of the cited text. */
  end?: number;
}

/** `[start, end)` of every fenced block in `content`. */
function fenceRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let openChar: string | null = null;
  let openAt = 0;
  let offset = 0;

  for (const line of content.split('\n')) {
    const fence = FENCE.exec(line);

    if (fence) {
      const char = fence[1][0];
      if (!openChar) {
        openChar = char;
        openAt = offset;
      } else if (char === openChar) {
        ranges.push([openAt, offset + line.length]);
        openChar = null;
      }
    }

    offset += line.length + 1;
  }

  // An unclosed fence is code to the end of the document.
  if (openChar) ranges.push([openAt, content.length]);
  return ranges;
}

function inside(ranges: Array<[number, number]>, position: number): boolean {
  return ranges.some(([from, to]) => position >= from && position <= to);
}

/**
 * `content` with a `[n](citation:n)` marker after each cited span.
 *
 * Returns the input unchanged when no source carries a usable span, so the
 * common case (Perplexity, our own web search, no sources at all) costs one
 * length check.
 */
export function insertSourceMarkers(
  content: string,
  sources?: readonly SpanSource[],
): string {
  if (!content || !sources?.length) return content;

  const usable = sources.flatMap((source, position) => {
    const start = source?.start;
    const end = source?.end;
    if (typeof start !== 'number' || typeof end !== 'number') return [];
    if (!Number.isInteger(start) || !Number.isInteger(end)) return [];
    if (start < 0 || end <= start || end > content.length) return [];
    return [{ index: position + 1, start, end }];
  });

  if (usable.length === 0) return content;

  const fences = fenceRanges(content);
  const byOffset = new Map<number, number[]>();

  for (const span of usable) {
    // Either end touching a fence means the provider is pointing at code.
    if (inside(fences, span.start) || inside(fences, span.end)) continue;
    const indices = byOffset.get(span.end) ?? [];
    indices.push(span.index);
    byOffset.set(span.end, indices);
  }

  if (byOffset.size === 0) return content;

  let out = '';
  let cursor = 0;

  for (const offset of [...byOffset.keys()].sort((a, b) => a - b)) {
    out += content.slice(cursor, offset);
    // Ascending index, so two sources cited by one sentence read `1 2`.
    for (const index of (byOffset.get(offset) ?? []).sort((a, b) => a - b)) {
      out += `[${index}](citation:${index})`;
    }
    cursor = offset;
  }

  return out + content.slice(cursor);
}
