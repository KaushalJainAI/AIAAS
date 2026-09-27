/**
 * A document spec (the shape the backend renders) and TipTap JSON (the shape
 * the Docs editor holds), converted purely in both directions.
 *
 * Marks become runs: each TipTap text node is one run, with bold/italic/
 * underline/strike/code flags and the link href. Alignment rides on headings
 * and paragraphs. Lists flatten one nesting level (a nested list item is a
 * sub-point); deeper nesting clamps rather than inventing a third level the
 * file cannot draw. Tables take their first row as the header. Images keep
 * their source through caller-supplied maps, so blob URLs never reach the
 * server and storage paths never reach the editor. Unknown nodes keep their
 * text and drop their structure — words survive even when layout does not.
 */
import type { JSONContent } from '@tiptap/core';

import { spans } from './officeSpec';
import type { Align, Block, ListItem, TextRun } from './officeSpec';

export interface DocSpecInput {
  title: string;
  subtitle?: string;
  theme?: string;
  blocks: Block[];
}

interface ImageMaps {
  /** What the editor shows for a storage path (a blob URL). */
  displaySrc?: (path: string) => string;
  /** What the spec stores for an editor source (a storage path). */
  storePath?: (src: string) => string;
  /**
   * Draw each table's caption under it. Read-only previews only: the editor
   * has no caption node, so a caption drawn there would come back as an
   * ordinary paragraph on the next save.
   */
  captions?: boolean;
}

type MarkName = 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'link';

function nodeText(node: JSONContent): string {
  if (node.text !== undefined) return node.text;
  return (node.content ?? []).map(nodeText).join('');
}

function runsOf(paragraph: JSONContent): TextRun[] {
  const runs: TextRun[] = [];
  for (const child of paragraph.content ?? []) {
    if (child.type === 'hardBreak') {
      runs.push({ text: '\n' });
      continue;
    }
    if (child.type !== 'text') {
      const nested = nodeText(child);
      if (nested) runs.push({ text: nested });
      continue;
    }
    const run: TextRun = { text: child.text ?? '' };
    for (const mark of child.marks ?? []) {
      const name = mark.type as MarkName;
      if (name === 'link') {
        if (mark.attrs?.href) run.link = String(mark.attrs.href).slice(0, 500);
      } else if (name === 'bold' || name === 'italic' || name === 'underline'
        || name === 'strike' || name === 'code') {
        run[name] = true;
      }
    }
    if (run.text) runs.push(run);
  }
  return runs;
}

function alignOf(node: JSONContent): Align | undefined {
  const align = node.attrs?.textAlign;
  return align === 'center' || align === 'right' || align === 'justify' ? align : undefined;
}

function listItems(node: JSONContent, nested: boolean): ListItem[] {
  const items: ListItem[] = [];
  for (const child of node.content ?? []) {
    if (child.type !== 'listItem') continue;
    const runs: TextRun[] = [];
    const sub: JSONContent[] = [];
    for (const grand of child.content ?? []) {
      if (grand.type === 'paragraph') runs.push(...runsOf(grand));
      else if (grand.type === 'bulletList' || grand.type === 'orderedList') sub.push(grand);
      else {
        const text = nodeText(grand);
        if (text) runs.push({ text });
      }
    }
    const text = runs.map((r) => r.text).join('');
    const styled = runs.some((r) => r.bold || r.italic || r.underline || r.strike || r.code || r.link);
    // Levels live beside the text in our bullets while TipTap nests
    // structurally; only one sub-level exists on paper, so deeper nesting
    // clamps to it and the file renders nested items flat.
    const here: ListItem = styled ? { runs } : text;
    items.push(nested ? withLevel(here) : here);
    for (const s of sub) {
      items.push(...listItems(s, true));
    }
  }
  return items;
}

function withLevel(item: ListItem): ListItem {
  if (typeof item === 'string') return { text: item, level: 1 };
  return { ...item, level: 1 };
}

/** TipTap JSON to spec blocks. */
export function tipTapToBlocks(doc: JSONContent, maps: ImageMaps = {}): Block[] {
  const blocks: Block[] = [];
  const storePath = maps.storePath ?? ((src: string) => src);
  for (const node of doc.content ?? []) {
    switch (node.type) {
      case 'heading': {
        const level = node.attrs?.level === 1 ? 1 : node.attrs?.level === 3 ? 3 : 2;
        const runs = runsOf(node);
        const block: Block = { type: 'heading', level, runs };
        const align = alignOf(node);
        if (align) (block as { align?: Align }).align = align;
        blocks.push(block);
        break;
      }
      case 'paragraph': {
        const runs = runsOf(node);
        if (!runs.some((r) => r.text.trim())) break;
        const block: Block = { type: 'paragraph', runs };
        const align = alignOf(node);
        if (align) (block as { align?: Align }).align = align;
        blocks.push(block);
        break;
      }
      case 'bulletList':
      case 'orderedList':
        blocks.push({
          type: node.type === 'bulletList' ? 'bullets' : 'numbered',
          items: listItems(node, false),
        });
        break;
      case 'blockquote': {
        const text = nodeText(node);
        if (text.trim()) blocks.push({ type: 'quote', runs: runsOf(node) });
        break;
      }
      case 'codeBlock': {
        const text = nodeText(node);
        if (text) blocks.push({ type: 'paragraph', runs: [{ text, code: true }] });
        break;
      }
      case 'table': {
        const grid: string[][] = [];
        for (const row of node.content ?? []) {
          if (row.type !== 'tableRow') continue;
          const cells: string[] = [];
          for (const cell of row.content ?? []) {
            if (cell.type !== 'tableCell' && cell.type !== 'tableHeader') continue;
            cells.push(nodeText(cell));
          }
          grid.push(cells);
        }
        if (grid.length > 0) {
          blocks.push({
            type: 'table',
            columns: grid[0],
            rows: grid.slice(1),
            caption: '',
          });
        }
        break;
      }
      case 'image': {
        const src = String(node.attrs?.src ?? '');
        if (src) {
          blocks.push({
            type: 'image',
            path: storePath(src),
            caption: String(node.attrs?.alt ?? node.attrs?.title ?? ''),
          });
        }
        break;
      }
      case 'horizontalRule':
        blocks.push({ type: 'page_break' });
        break;
      default: {
        const text = nodeText(node);
        if (text.trim()) blocks.push({ type: 'paragraph', text });
        break;
      }
    }
  }
  return blocks;
}

/** Drop what the server would refuse, so saving never fails on empties. */
export function pruneBlocks(blocks: Block[]): Block[] {
  const textOf = (b: Block): string => {
    const anyBlock = b as { text?: unknown; runs?: TextRun[] };
    if (typeof anyBlock.text === 'string') return anyBlock.text;
    return (anyBlock.runs ?? []).map((r) => r.text).join('');
  };
  const itemText = (item: ListItem): string => {
    if (typeof item === 'string') return item;
    if (typeof item.text === 'string') return item.text;
    return (item.runs ?? []).map((r) => r.text).join('');
  };
  return blocks.flatMap((b): Block[] => {
    if (b.type === 'heading' || b.type === 'paragraph' || b.type === 'quote') {
      return textOf(b).trim() ? [b] : [];
    }
    if (b.type === 'bullets' || b.type === 'numbered') {
      const items = b.items.filter((i) => itemText(i).trim());
      return items.length ? [{ ...b, items }] : [];
    }
    return [b];
  });
}

function marksOf(run: TextRun): JSONContent['marks'] {
  const marks: NonNullable<JSONContent['marks']> = [];
  if (run.bold) marks.push({ type: 'bold' });
  if (run.italic) marks.push({ type: 'italic' });
  if (run.underline) marks.push({ type: 'underline' });
  if (run.strike) marks.push({ type: 'strike' });
  if (run.code) marks.push({ type: 'code' });
  if (run.link) marks.push({ type: 'link', attrs: { href: run.link } });
  return marks.length ? marks : undefined;
}

function inlineNodes(text: string | undefined, runs: TextRun[] | undefined): JSONContent[] {
  if (runs) {
    const out: JSONContent[] = [];
    for (const run of runs) {
      for (const [i, part] of run.text.split('\n').entries()) {
        if (i > 0) out.push({ type: 'hardBreak' });
        if (part) out.push({ type: 'text', text: part, marks: marksOf(run) });
      }
    }
    return out;
  }
  // Plain `text` may carry `**bold**` / `*italic*` markers: the agents' tools
  // write them, and the file renderers honour them (`office/document.py`).
  // Parsed with the same rule the file uses, so the page and the file agree.
  if (!text) return [];
  return spans(text).map((span) => ({
    type: 'text',
    text: span.text,
    marks: span.bold ? [{ type: 'bold' }] : span.italic ? [{ type: 'italic' }] : undefined,
  }));
}

function itemNodes(item: ListItem): JSONContent[] {
  if (typeof item === 'string') return inlineNodes(item, undefined);
  return inlineNodes(item.text, item.runs);
}

/** Spec blocks to a TipTap document. */
export function specToTipTap(blocks: Block[], maps: ImageMaps = {}): JSONContent {
  const displaySrc = maps.displaySrc ?? ((path: string) => path);
  const content: JSONContent[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        content.push({
          type: 'heading',
          attrs: { level: block.level, textAlign: (block as { align?: string }).align ?? null },
          content: inlineNodes(block.text, block.runs),
        });
        break;
      case 'paragraph':
      case 'quote': {
        const inner: JSONContent = {
          type: 'paragraph',
          attrs: block.type === 'paragraph'
            ? { textAlign: (block as { align?: string }).align ?? null }
            : {},
          content: inlineNodes(
            block.type === 'paragraph' ? block.text : (block as { text?: string }).text,
            (block as { runs?: TextRun[] }).runs,
          ),
        };
        content.push(block.type === 'quote' ? { type: 'blockquote', content: [inner] } : inner);
        break;
      }
      case 'bullets':
      case 'numbered': {
        const listType = block.type === 'bullets' ? 'bulletList' : 'orderedList';
        const items: JSONContent[] = [];
        for (const item of block.items) {
          const level = typeof item === 'string' ? 0 : ((item as { level?: number }).level ?? 0);
          const nodes = itemNodes(item);
          if (level > 0 && items.length > 0) {
            const prev = items[items.length - 1];
            prev.content = [...(prev.content ?? []), {
              type: listType,
              content: [{ type: 'listItem', content: [{ type: 'paragraph', content: nodes }] }],
            }];
          } else {
            items.push({ type: 'listItem', content: [{ type: 'paragraph', content: nodes }] });
          }
        }
        if (items.length) content.push({ type: listType, content: items });
        break;
      }
      case 'table':
        // The first row is the header, as the file draws it and as
        // `tipTapToBlocks` reads it back.
        content.push({
          type: 'table',
          content: [block.columns, ...block.rows].map((row, i) => ({
            type: 'tableRow',
            content: row.map((cell) => ({
              type: i === 0 ? 'tableHeader' : 'tableCell',
              content: [{ type: 'paragraph', content: cell ? [{ type: 'text', text: cell }] : [] }],
            })),
          })),
        });
        if (maps.captions && block.caption) {
          content.push({
            type: 'paragraph',
            content: [{ type: 'text', text: block.caption, marks: [{ type: 'italic' }] }],
          });
        }
        break;
      case 'image':
        content.push({
          type: 'image',
          attrs: { src: displaySrc(block.path), alt: block.caption ?? null, title: block.caption ?? null },
        });
        break;
      case 'chart': {
        // The file's native chart, as data: the same fallback the preview
        // table uses, so a readonly page never claims a picture it has not.
        const xs: string[] = [];
        for (const s of block.chart.series) {
          for (const p of s.points) {
            if (!xs.includes(p.x)) xs.push(p.x);
          }
        }
        const columns = [block.chart.x_label || 'Category', ...block.chart.series.map((s) => s.name)];
        const rows = xs.map((x) => [x, ...block.chart.series.map((s) => {
          const y = s.points.find((p) => p.x === x)?.y;
          return y === null || y === undefined ? '—' : String(y);
        })]);
        content.push({
          type: 'paragraph',
          content: [{ type: 'text', text: block.chart.title }],
        });
        content.push({
          type: 'table',
          content: [columns, ...rows].map((row, i) => ({
            type: 'tableRow',
            content: row.map((cell) => ({
              type: i === 0 ? 'tableHeader' : 'tableCell',
              content: [{ type: 'paragraph', content: cell ? [{ type: 'text', text: cell }] : [] }],
            })),
          })),
        });
        break;
      }
      case 'page_break':
        content.push({ type: 'horizontalRule' });
        break;
    }
  }
  if (!content.length) content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}
