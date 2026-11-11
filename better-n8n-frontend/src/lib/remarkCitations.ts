/**
 * Citation pills for the many ways a model writes a reference to a source.
 *
 * **Why this is not a regex over the message.** The first version rewrote the
 * raw markdown before it was parsed:
 *
 *     content.replace(/\[(\d+)\]/g, '[$1](citation:$1)')
 *
 * The parser had not run yet, so the rewrite could not tell prose from code.
 * Every bracketed number inside a fenced block became a citation: a Python
 * snippet with `grid[0]` rendered as `grid[0](citation:0)`, and the copy
 * button on that block handed the broken text to the clipboard.
 *
 * This version runs after parsing, on the tree, where "this text is prose" is
 * already known. Only `text` nodes become citations; code, inline code and
 * the inside of an existing link are left as they are.
 *
 * **The other half of the feature.** react-markdown runs every `href` through
 * `defaultUrlTransform`, which keeps http(s), irc(s), mailto and xmpp and
 * blanks everything else. `citation:1` is not on that list, so a citation
 * link lost its href before the renderer saw it and the pill never drew. The
 * transform at the bottom of this file is the default one with the citation
 * scheme let through.
 *
 * **The marker styles.** Which marker a model emits is a property of the model,
 * not of the app, and a deployment serves many models. The ones seen in the
 * wild, all accepted here:
 *
 *     [1]              OpenAI, Claude, Gemini, most open models
 *     [1, 2] [1;2]     the same, when a sentence cites several at once
 *     【1】            Perplexity and CJK-trained models (full-width brackets)
 *     【1†source】      Perplexity's older form, with a trailing label
 *     <cite …>…</cite> Claude's web-search citation wrapper
 *
 * A marker is only a citation if `sources[i]` exists. When the count is known
 * and the number is outside it, the text is left exactly as the model wrote
 * it: a pill that opens nothing is worse than a stray bracket, and a blank
 * source list is the usual reason a number is unresolvable.
 */

import type { Root } from 'mdast';
import type { Plugin } from 'unified';
import { defaultUrlTransform, type UrlTransform } from 'react-markdown';

/**
 * Every inline reference style, in one pass.
 *
 * `\d{1,3}` and not `\d+`: a four-digit number in brackets is a year or an
 * index into someone's array, never the 1024th source. It also keeps `[2024]`
 * from being read as `[202]` + `4]`.
 */
const CITATION_PATTERN = /\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\]|【(\d{1,3})(?:†[^】]*)?】/g;

/** Claude's citation wrapper, which is not HTML we render. */
const CITE_TAG_PATTERN = /<\/?cite\b[^>]*>/gi;

/**
 * Nodes whose text is literal rather than prose.
 *
 * `code` and `inlineCode` hold their content in `value`, not in children, so
 * they are never descended into anyway. `link` is listed because a link
 * inside a link is not valid markdown and the renderer would drop it.
 */
const OPAQUE_NODES = new Set(['code', 'inlineCode', 'link', 'linkReference']);

export interface CitationOptions {
  /**
   * How many sources the message has. `[3]` in a message with two sources is
   * left as text. Omitted means "trust the model", which only the file
   * preview wants: it renders documents, not answers.
   */
  sources?: number;
}

/** The part of the tree this walks. Structural, so it needs no mdast casts. */
interface TreeNode {
  type: string;
  value?: string;
  url?: string;
  children?: TreeNode[];
}

/** The numbers a single marker names, or null when it is not a reference. */
function citedIndices(raw: string): number[] | null {
  const numbers = raw.split(/[,;]/).map((part) => Number.parseInt(part.trim(), 10));
  if (numbers.some((n) => !Number.isInteger(n) || n < 1)) return null;
  return numbers;
}

/**
 * One text node, split into prose and citation links.
 *
 * A fresh regex per call: a shared global regex carries `lastIndex` between
 * uses, and a missed reset silently drops the first citation of a message.
 */
function splitText(value: string, limit: number): TreeNode[] {
  const text = value.replace(CITE_TAG_PATTERN, '');
  const pattern = new RegExp(CITATION_PATTERN);
  const nodes: TreeNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const [full, bracketed, cjk] = match;
    const start = match.index ?? 0;
    const indices = citedIndices(bracketed ?? cjk ?? '');

    if (start > cursor) nodes.push({ type: 'text', value: text.slice(cursor, start) });

    // Not a reference, or one we cannot resolve: keep the original bytes.
    if (!indices || indices.some((index) => index > limit)) {
      nodes.push({ type: 'text', value: full });
      cursor = start + full.length;
      continue;
    }

    indices.forEach((index, position) => {
      if (position > 0) nodes.push({ type: 'text', value: ', ' });
      nodes.push({
        type: 'link',
        url: `citation:${index}`,
        children: [{ type: 'text', value: String(index) }],
      });
    });
    cursor = start + full.length;
  }

  if (cursor < text.length) nodes.push({ type: 'text', value: text.slice(cursor) });
  return nodes;
}

/** Rewrite the prose under `node`, leaving code and link interiors alone. */
function rewrite(node: TreeNode, limit: number): void {
  if (!node.children) return;
  const next: TreeNode[] = [];

  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      next.push(...splitText(child.value, limit));
      continue;
    }

    // The parser turns `<cite …>` into an `html` node, not text, so the tag
    // has to be dropped here or it prints verbatim around the cited sentence.
    if (child.type === 'html' && typeof child.value === 'string') {
      const cleaned = child.value.replace(CITE_TAG_PATTERN, '');
      if (cleaned === child.value) next.push(child);
      else if (cleaned.trim()) next.push({ ...child, value: cleaned });
      continue;
    }

    if (!OPAQUE_NODES.has(child.type)) rewrite(child, limit);
    next.push(child);
  }

  node.children = next;
}

/**
 * Rewrites inline references in prose into links the citation renderer knows.
 *
 * A remark plugin, so it runs on the parsed tree, after the markdown has
 * told prose and code apart.
 */
export const remarkCitations: Plugin<[CitationOptions?], Root> = (options) => (tree) => {
  rewrite(tree as unknown as TreeNode, options?.sources ?? Number.POSITIVE_INFINITY);
};

/**
 * react-markdown's URL sanitizer, with the citation scheme let through.
 *
 * Everything else — `javascript:`, `data:`, `file:` — keeps the default
 * treatment and is blanked.
 */
export const citationUrlTransform: UrlTransform = (url) =>
  url.startsWith('citation:') ? url : defaultUrlTransform(url);
