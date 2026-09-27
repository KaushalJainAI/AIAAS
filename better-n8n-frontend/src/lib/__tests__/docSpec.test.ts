import { describe as group, expect, it } from 'vitest';
import { pruneBlocks, specToTipTap, tipTapToBlocks } from '../docSpec';
import type { Block } from '../officeSpec';

/**
 * Spec ⇄ TipTap JSON: marks become runs, alignment rides along, lists
 * flatten one level, tables take their first row as the header, images keep
 * their source through caller maps, and unknown nodes keep their words.
 */
group('tipTapToBlocks', () => {
  it('turns marks into runs', () => {
    const blocks = tipTapToBlocks({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hi ' },
          { type: 'text', text: 'there', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com' } }] },
        ],
      }],
    });
    expect(blocks).toEqual([{
      type: 'paragraph',
      runs: [{ text: 'Hi ' }, { text: 'there', bold: true, link: 'https://example.com' }],
    }]);
  });

  it('reads alignment, lists, quotes and tables', () => {
    const blocks = tipTapToBlocks({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [{ type: 'text', text: 'Part' }] },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
                {
                  type: 'bulletList',
                  content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'sub' }] }] }],
                },
              ],
            },
          ],
        },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }] },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'h' }] }] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'v' }] }] },
              ],
            },
          ],
        },
      ],
    });
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 2, align: 'center' });
    expect(blocks[1]).toEqual({
      type: 'bullets',
      items: ['one', 'two', { text: 'sub', level: 1 }],
    });
    expect(blocks[2]).toEqual({ type: 'quote', runs: [{ text: 'quoted' }] });
    expect(blocks[3]).toEqual({ type: 'table', columns: ['h'], rows: [['v']], caption: '' });
  });

  it('maps image sources through the caller and drops empty paragraphs', () => {
    const blocks = tipTapToBlocks(
      {
        type: 'doc',
        content: [
          { type: 'image', attrs: { src: 'blob:1', alt: 'fig' } },
          { type: 'paragraph' },
        ],
      },
      { storePath: (src) => (src === 'blob:1' ? '/Reports/fig.png' : src) },
    );
    expect(blocks).toEqual([{ type: 'image', path: '/Reports/fig.png', caption: 'fig' }]);
  });

  it('keeps the words of unknown nodes', () => {
    const blocks = tipTapToBlocks({
      type: 'doc',
      content: [{ type: 'fancyBox', content: [{ type: 'text', text: 'survives' }] }],
    });
    expect(blocks).toEqual([{ type: 'paragraph', text: 'survives' }]);
  });
});

group('specToTipTap', () => {
  it('round-trips blocks, marks, alignment and nesting', () => {
    const blocks: Block[] = [
      { type: 'heading', level: 2, align: 'center', runs: [{ text: 'Hi', bold: true }] },
      { type: 'paragraph', runs: [{ text: 'a' }, { text: 'b', italic: true, link: 'https://x.example' }] },
      { type: 'bullets', items: ['one', { text: 'sub', level: 1 }] },
      { type: 'image', path: '/r.png', caption: 'fig' },
      { type: 'page_break' },
    ];
    const doc = specToTipTap(blocks, { displaySrc: (p) => `blob:${p}` });
    expect(doc.type).toBe('doc');
    const back = tipTapToBlocks(doc, { storePath: (s) => s.replace(/^blob:/, '') });
    expect(back[0]).toMatchObject({ type: 'heading', level: 2, align: 'center' });
    expect(back[1]).toEqual({
      type: 'paragraph',
      runs: [{ text: 'a' }, { text: 'b', italic: true, link: 'https://x.example' }],
    });
    expect(back[2]).toEqual({ type: 'bullets', items: ['one', { text: 'sub', level: 1 }] });
    expect(back[3]).toEqual([{ type: 'image', path: '/r.png', caption: 'fig' }][0]);
    expect(back[4]).toEqual({ type: 'page_break' });
  });

  it('never returns an empty document', () => {
    expect(specToTipTap([])).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
  // Agents write emphasis as markers in plain text; the file renders them
  // (`office/document.py`), so the page must too, not show the asterisks.
  it('draws **bold** and *italic* markers in plain text as marks', () => {
    const doc = specToTipTap([
      { type: 'paragraph', text: 'Revenue grew **38%** and *fast*.' },
      { type: 'bullets', items: ['a **key** point'] },
    ]);
    expect(doc.content?.[0].content).toEqual([
      { type: 'text', text: 'Revenue grew ', marks: undefined },
      { type: 'text', text: '38%', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' and ', marks: undefined },
      { type: 'text', text: 'fast', marks: [{ type: 'italic' }] },
      { type: 'text', text: '.', marks: undefined },
    ]);
    const item = doc.content?.[1].content?.[0].content?.[0].content;
    expect(item?.[1]).toEqual({ type: 'text', text: 'key', marks: [{ type: 'bold' }] });
    // Saved back as runs: the emphasis survives an edit instead of the stars.
    expect(tipTapToBlocks(doc)[0]).toEqual({
      type: 'paragraph',
      runs: [{ text: 'Revenue grew ' }, { text: '38%', bold: true }, { text: ' and ' },
        { text: 'fast', italic: true }, { text: '.' }],
    });
  });

  it('heads a table with its first row, and shows a caption only when asked', () => {
    const table: Block = { type: 'table', columns: ['A'], rows: [['1']], caption: 'Table 1' };
    const editor = specToTipTap([table]);
    expect(editor.content?.[0].content?.[0].content?.[0].type).toBe('tableHeader');
    expect(editor.content?.[0].content?.[1].content?.[0].type).toBe('tableCell');
    expect(editor.content).toHaveLength(1);

    const preview = specToTipTap([table], { captions: true });
    expect(preview.content?.[1]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Table 1', marks: [{ type: 'italic' }] }],
    });
  });
});

group('pruneBlocks', () => {
  it('drops empties but keeps structure', () => {
    expect(pruneBlocks([
      { type: 'paragraph', text: '  ' },
      { type: 'paragraph', runs: [{ text: 'kept' }] },
      { type: 'bullets', items: [' ', { text: 'x' }] },
      { type: 'table', columns: ['h'], rows: [], caption: '' },
    ])).toEqual([
      { type: 'paragraph', runs: [{ text: 'kept' }] },
      { type: 'bullets', items: [{ text: 'x' }] },
      { type: 'table', columns: ['h'], rows: [], caption: '' },
    ]);
  });
});
